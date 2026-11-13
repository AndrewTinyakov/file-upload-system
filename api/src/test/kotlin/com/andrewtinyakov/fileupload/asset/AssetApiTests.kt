package com.andrewtinyakov.fileupload.asset

import com.andrewtinyakov.fileupload.MutableClock
import com.andrewtinyakov.fileupload.TestcontainersConfig
import com.andrewtinyakov.fileupload.asset.messaging.listener.AssetPreparationResultListener
import com.andrewtinyakov.fileupload.asset.model.AssetStatus
import com.andrewtinyakov.fileupload.asset.model.FileAssetId
import com.andrewtinyakov.fileupload.asset.model.SessionStatus
import com.andrewtinyakov.fileupload.asset.model.UploadSessionId
import com.andrewtinyakov.fileupload.asset.repository.FileAssetRepository
import com.andrewtinyakov.fileupload.asset.repository.UploadSessionRepository
import com.andrewtinyakov.fileupload.asset.scheduling.AssetCleanupScheduler
import com.andrewtinyakov.fileupload.asset.scheduling.UploadSessionExpirationScheduler
import com.andrewtinyakov.fileupload.infrastructure.messaging.MessageRoute
import com.andrewtinyakov.fileupload.infrastructure.outbox.OutboxPublishingScheduler
import com.andrewtinyakov.fileupload.infrastructure.outbox.OutboxService
import com.github.f4b6a3.ulid.UlidCreator
import com.rabbitmq.client.Channel
import io.micrometer.core.instrument.MeterRegistry
import org.awaitility.Awaitility
import org.junit.jupiter.api.Assertions
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import org.mockito.Mockito
import org.springframework.amqp.core.Binding
import org.springframework.amqp.core.Message
import org.springframework.amqp.core.MessageDeliveryMode
import org.springframework.amqp.core.MessageProperties
import org.springframework.amqp.core.Queue
import org.springframework.amqp.rabbit.core.RabbitAdmin
import org.springframework.amqp.rabbit.core.RabbitTemplate
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.boot.test.web.server.LocalServerPort
import org.springframework.context.annotation.Import
import org.springframework.transaction.UnexpectedRollbackException
import org.springframework.transaction.support.TransactionTemplate
import software.amazon.awssdk.core.sync.RequestBody
import software.amazon.awssdk.services.s3.S3Client
import tools.jackson.databind.JsonNode
import tools.jackson.databind.ObjectMapper
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.time.OffsetDateTime
import java.util.Base64
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@Import(TestcontainersConfig::class)
@Tag("integration")
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = [
        "file-upload.scheduling.enabled=false",
        "file-upload.storage.assets-bucket=prepared-assets",
        "file-upload.upload.multipart-threshold=10",
        "file-upload.upload.part-size=5242880",
        "spring.security.user.name=metrics",
        "spring.security.user.password=metrics-local",
    ],
)
class AssetApiTests
    @Autowired
    constructor(
        private val mapper: ObjectMapper,
        private val s3: S3Client,
        private val clock: MutableClock,
        private val expiration: UploadSessionExpirationScheduler,
        private val publication: OutboxPublishingScheduler,
        private val rabbit: RabbitTemplate,
        private val listener: AssetPreparationResultListener,
        private val cleanup: AssetCleanupScheduler,
        private val outboxService: OutboxService,
        private val tx: TransactionTemplate,
        private val sessionRepository: UploadSessionRepository,
        private val assetRepository: FileAssetRepository,
        private val meterRegistry: MeterRegistry,
    ) {
        @LocalServerPort
        private var port: Int = 0
        private val client = HttpClient.newHttpClient()
        private val user = UlidCreator.getMonotonicUlid().toString()

        @BeforeEach
        fun createBuckets() {
            clock.reset()
            val buckets =
                s3
                    .listBuckets()
                    .buckets()
                    .map { it.name() }
                    .toSet()
            listOf(
                "uploads",
                "prepared-assets",
            ).filterNot(buckets::contains).forEach { name ->
                s3.createBucket { it.bucket(name) }
            }
        }

        @Test
        fun `database failure returns the preparation event to the queue`() {
            val command = preparationCommand()
            val channel = Mockito.mock(Channel::class.java)
            val headers =
                MessageProperties().apply {
                    receivedRoutingKey = "asset.preparation.completed.v1"
                    deliveryTag = 1
                }
            val transactionManager = tx.transactionManager
            val readOnly =
                TransactionTemplate(requireNotNull(transactionManager)).apply {
                    isReadOnly = true
                }
            Assertions.assertThrows(UnexpectedRollbackException::class.java) {
                readOnly.executeWithoutResult {
                    listener.onPreparationEvent(
                        Message(
                            mapper.writeValueAsBytes(preparationCompletedEvent(command)),
                            headers,
                        ),
                        channel,
                    )
                }
            }
            Mockito.verify(channel).basicReject(
                1,
                true,
            )
            Mockito
                .verify(
                    channel,
                    Mockito.never(),
                ).basicAck(
                    1,
                    false,
                )
            assertEquals(
                "PREPARING",
                mapper
                    .readTree(
                        request(
                            "GET",
                            "/assets/${command["assetId"].stringValue()}",
                        ).body(),
                    )[
                    "status",
                ].stringValue(),
            )
        }

        @Test
        fun `changed request with the same key returns an idempotency conflict`() {
            val key = UlidCreator.getMonotonicUlid().toString()
            val body = """{"filename":"policy.txt","contentType":"text/plain","byteSize":5,"handlingMode":"DOCUMENT"}"""
            assertEquals(
                201,
                request(
                    "POST",
                    "/upload-sessions",
                    body,
                    key,
                ).statusCode(),
            )
            val oversized =
                body.replace(
                    "\"byteSize\":5",
                    "\"byteSize\":5368709121",
                )
            val conflict =
                request(
                    "POST",
                    "/upload-sessions",
                    oversized,
                    key,
                )
            assertEquals(
                409,
                conflict.statusCode(),
                conflict.body(),
            )
            assertEquals(
                "IDEMPOTENCY_CONFLICT",
                mapper.readTree(conflict.body())["code"].stringValue(),
            )
            assertEquals(
                400,
                request(
                    "POST",
                    "/upload-sessions",
                    oversized,
                ).statusCode(),
            )
        }

        @Test
        fun `outbox retries a message after its route is added`() {
            publication.publishPending()
            val id = UlidCreator.getMonotonicUlid().toString()
            tx.executeWithoutResult {
                outboxService.enqueue(
                    id,
                    AssetApiTests::class,
                    id,
                    MessageRoute(
                        exchange = "asset.commands",
                        routingKey = "test.$id",
                    ),
                    mapOf("id" to id),
                )
            }
            Assertions.assertThrows(IllegalStateException::class.java) { publication.publishPending() }
            val admin = RabbitAdmin(rabbit.connectionFactory)
            val queue = "test.$id"
            admin.declareQueue(
                Queue(
                    queue,
                    true,
                    false,
                    false,
                ),
            )
            admin.declareBinding(
                Binding(
                    queue,
                    Binding.DestinationType.QUEUE,
                    "asset.commands",
                    queue,
                    emptyMap(),
                ),
            )
            try {
                assertEquals(
                    1,
                    publication.publishPending(),
                )
                val received =
                    rabbit.receive(
                        queue,
                        5000,
                    )
                assertEquals(
                    id,
                    requireNotNull(received).messageProperties.messageId,
                )
                assertEquals(
                    0,
                    publication.publishPending(),
                )
            } finally {
                admin.deleteQueue(queue)
            }
        }

        @Test
        fun `concurrent publishers send each outbox message once`() {
            publication.publishPending()
            val admin = RabbitAdmin(rabbit.connectionFactory)
            val queue = "test.${UlidCreator.getMonotonicUlid()}"
            admin.declareQueue(
                Queue(
                    queue,
                    true,
                    false,
                    false,
                ),
            )
            admin.declareBinding(
                Binding(
                    queue,
                    Binding.DestinationType.QUEUE,
                    "asset.commands",
                    queue,
                    emptyMap(),
                ),
            )
            val ids = (1..8).map { UlidCreator.getMonotonicUlid().toString() }
            tx.executeWithoutResult {
                ids.forEach {
                    outboxService.enqueue(
                        it,
                        AssetApiTests::class,
                        it,
                        MessageRoute(
                            exchange = "asset.commands",
                            routingKey = queue,
                        ),
                        mapOf("id" to it),
                    )
                }
            }
            try {
                Executors.newVirtualThreadPerTaskExecutor().use { executor ->
                    val counts = (1..4).map { executor.submit<Int> { publication.publishPending() } }.map { it.get() }
                    assertEquals(
                        8,
                        counts.sum(),
                    )
                }
                val delivered =
                    ids.map {
                        val received =
                            rabbit.receive(
                                queue,
                                5000,
                            )
                        requireNotNull(received).messageProperties.messageId
                    }
                assertEquals(
                    ids.toSet(),
                    delivered.toSet(),
                )
                assertEquals(
                    null,
                    rabbit.receive(queue),
                )
            } finally {
                admin.deleteQueue(queue)
            }
        }

        @Test
        fun `publisher sends more than one outbox batch`() {
            publication.publishPending()
            val admin = RabbitAdmin(rabbit.connectionFactory)
            val queue = "test.${UlidCreator.getMonotonicUlid()}"
            admin.declareQueue(
                Queue(
                    queue,
                    true,
                    false,
                    false,
                ),
            )
            admin.declareBinding(
                Binding(
                    queue,
                    Binding.DestinationType.QUEUE,
                    "asset.commands",
                    queue,
                    emptyMap(),
                ),
            )
            val ids = (1..21).map { UlidCreator.getMonotonicUlid().toString() }
            tx.executeWithoutResult {
                ids.forEach {
                    outboxService.enqueue(
                        it,
                        AssetApiTests::class,
                        it,
                        MessageRoute(
                            exchange = "asset.commands",
                            routingKey = queue,
                        ),
                        mapOf("id" to it),
                    )
                }
            }
            try {
                assertEquals(
                    21,
                    publication.publishPending(),
                )
                val delivered =
                    ids.map {
                        val received =
                            rabbit.receive(
                                queue,
                                5000,
                            )
                        requireNotNull(received).messageProperties.messageId
                    }
                assertEquals(
                    ids.toSet(),
                    delivered.toSet(),
                )
                assertEquals(
                    null,
                    rabbit.receive(queue),
                )
            } finally {
                admin.deleteQueue(queue)
            }
        }

        @Test
        fun `database prevents concurrent changes to an expired upload session`() {
            val session =
                mapper.readTree(
                    request(
                        "POST",
                        "/upload-sessions",
                        """{"filename":"lock.txt","contentType":"text/plain","byteSize":5,"handlingMode":"DOCUMENT"}""",
                    ).body(),
                )
            val assetId = FileAssetId(session["assetId"].stringValue())
            val sessionId = UploadSessionId(session["sessionId"].stringValue())
            clock.advance(Duration.ofHours(7))
            val now = OffsetDateTime.now(clock)
            val locked = CountDownLatch(1)
            val release = CountDownLatch(1)
            Executors.newVirtualThreadPerTaskExecutor().use { executor ->
                val first =
                    executor.submit {
                        tx.executeWithoutResult {
                            assertTrue(
                                sessionRepository
                                    .findExpiredForUpdate(
                                        now,
                                        1000,
                                    ).any {
                                        it.id == sessionId
                                    },
                            )
                            locked.countDown()
                            val released =
                                release.await(
                                    10,
                                    TimeUnit.SECONDS,
                                )
                            check(released)
                        }
                    }
                try {
                    assertTrue(
                        locked.await(
                            10,
                            TimeUnit.SECONDS,
                        ),
                    )
                    tx.executeWithoutResult {
                        assertTrue(
                            sessionRepository
                                .findExpiredForUpdate(
                                    now,
                                    1000,
                                ).isEmpty(),
                        )
                    }
                } finally {
                    release.countDown()
                }
                first.get()
            }
            tx.executeWithoutResult {
                assetRepository.transitionStatus(
                    assetId,
                    AssetStatus.AWAITING_UPLOAD,
                    AssetStatus.FAILED,
                    now,
                    "UPLOAD_EXPIRED",
                )
            }
            Assertions.assertThrows(IllegalStateException::class.java) {
                tx.executeWithoutResult {
                    assetRepository.transitionStatus(
                        assetId,
                        AssetStatus.AWAITING_UPLOAD,
                        AssetStatus.PREPARING,
                        now,
                    )
                }
            }
            assertEquals(
                AssetStatus.FAILED,
                assetRepository.findById(assetId)?.status,
            )
            tx.executeWithoutResult {
                sessionRepository.close(
                    sessionId,
                    SessionStatus.EXPIRED,
                    now,
                )
            }
        }

        @Test
        fun `preparation command needs delivery limit evidence`() {
            val command = preparationCommand()
            val unprovenChannel = Mockito.mock(Channel::class.java)
            listener.onDeadLetterCommand(
                Message(
                    mapper.writeValueAsBytes(command),
                    MessageProperties().apply {
                        receivedRoutingKey = "document.prepare.v1"
                        deliveryTag = 1
                    },
                ),
                unprovenChannel,
            )
            Mockito.verify(unprovenChannel).basicReject(
                1,
                false,
            )
            assertEquals(
                "PREPARING",
                mapper
                    .readTree(
                        request(
                            "GET",
                            "/assets/${command["assetId"].stringValue()}",
                        ).body(),
                    )["status"]
                    .stringValue(),
            )

            val channel = Mockito.mock(Channel::class.java)
            val headers =
                MessageProperties().apply {
                    receivedRoutingKey = "document.prepare.v1"
                    deliveryTag = 1
                    setHeader(
                        "x-death",
                        listOf(
                            mapOf(
                                "reason" to "delivery_limit",
                                "queue" to "document.jobs",
                            ),
                        ),
                    )
                }
            listener.onDeadLetterCommand(
                Message(
                    mapper.writeValueAsBytes(command),
                    headers,
                ),
                channel,
            )
            Mockito.verify(channel).basicAck(
                1,
                false,
            )
            assertEquals(
                "RETRY_EXHAUSTED",
                mapper
                    .readTree(
                        request(
                            "GET",
                            "/assets/${command["assetId"].stringValue()}",
                        ).body(),
                    )[
                    "failureCode",
                ].stringValue(),
            )
        }

        @Test
        fun `completion event cannot revive a permanently failed file asset`() {
            val permanent = preparationCommand()
            deliverPreparationEvent(
                "asset.preparation.failed.v1",
                preparationFailedEvent(permanent, "FUTURE_INPUT_FAILURE"),
            )
            deliverPreparationEvent(
                "asset.preparation.completed.v1",
                preparationCompletedEvent(permanent),
                reject = true,
            )
            assertEquals(
                "FUTURE_INPUT_FAILURE",
                mapper
                    .readTree(
                        request(
                            "GET",
                            "/assets/${permanent["assetId"].stringValue()}",
                        ).body(),
                    )[
                    "failureCode",
                ].stringValue(),
            )
        }

        @Test
        fun `idempotency key identifies one upload session for one user`() {
            val key = UlidCreator.getMonotonicUlid().toString()
            val body = """{"filename":"parallel.txt","contentType":"text/plain","byteSize":5,"handlingMode":"DOCUMENT"}"""
            Executors.newVirtualThreadPerTaskExecutor().use { executor ->
                val responses =
                    (1..8)
                        .map {
                            executor.submit<HttpResponse<String>> {
                                request(
                                    "POST",
                                    "/upload-sessions",
                                    body,
                                    key,
                                )
                            }
                        }.map { it.get() }
                responses.forEach {
                    assertEquals(
                        201,
                        it.statusCode(),
                        it.body(),
                    )
                }
                assertEquals(
                    1,
                    responses.map { mapper.readTree(it.body())["sessionId"].stringValue() }.distinct().size,
                )
            }
            assertEquals(
                409,
                request(
                    "POST",
                    "/upload-sessions",
                    body.replace(
                        "parallel.txt",
                        "other.txt",
                    ),
                    key,
                ).statusCode(),
            )
            assertEquals(
                201,
                request(
                    "POST",
                    "/upload-sessions",
                    body,
                    key,
                    UlidCreator.getMonotonicUlid().toString(),
                ).statusCode(),
            )
        }

        @Test
        fun `late completion makes a file asset ready after retries stop`() {
            val command = preparationCommand()
            val dispatchTimer = meterRegistry.get("file.upload.preparation.dispatch.duration")
                .tags("handling_mode", "document", "outcome", "completed").timer()
            val deliveryTimer = meterRegistry.get("file.upload.preparation.result.delivery.duration")
                .tags("handling_mode", "document", "outcome", "completed").timer()
            val initialDispatchCount = dispatchTimer.count()
            val initialDeliveryCount = deliveryTimer.count()
            clock.advance(Duration.ofMinutes(1))
            val failure =
                preparationFailedEvent(command, "RETRY_EXHAUSTED")
            deliverPreparationEvent(
                "asset.preparation.failed.v1",
                failure,
            )
            clock.advance(Duration.ofMinutes(2))
            deliverPreparationEvent(
                "asset.preparation.completed.v1",
                preparationCompletedEvent(command),
            )
            deliverPreparationEvent(
                "asset.preparation.completed.v1",
                preparationCompletedEvent(command),
            )
            deliverPreparationEvent(
                "asset.preparation.completed.v1",
                preparationCompletedEvent(
                    command,
                    command["destinationPrefix"].stringValue() + "different",
                ),
                reject = true,
            )
            deliverPreparationEvent(
                "asset.preparation.failed.v1",
                failure,
            )
            assertEquals(initialDispatchCount + 1, dispatchTimer.count())
            assertEquals(initialDeliveryCount + 1, deliveryTimer.count())
            val asset =
                mapper.readTree(
                    request(
                        "GET",
                        "/assets/${command["assetId"].stringValue()}",
                    ).body(),
                )
            assertEquals(
                "READY",
                asset["status"].stringValue(),
            )
            assertEquals(
                1,
                asset["variants"].size(),
            )
            assertTrue(asset["variants"][0]["url"].stringValue().contains("/prepared-assets/assets/"))
            assertTrue(asset["variants"][0]["url"].stringValue().endsWith("/original"))
        }

        @Test
        fun `completion event rejects a variant from another file asset`() {
            val command = preparationCommand()
            deliverPreparationEvent(
                "asset.preparation.completed.v1",
                preparationCompletedEvent(
                    command,
                    "assets/another-asset/original",
                ),
                reject = true,
            )
            assertEquals(
                "PREPARING",
                mapper
                    .readTree(
                        request(
                            "GET",
                            "/assets/${command["assetId"].stringValue()}",
                        ).body(),
                    )[
                    "status",
                ].stringValue(),
            )
        }

        @Test
        fun `upload session rejects a negative byte size`() {
            assertEquals(
                400,
                request(
                    "POST",
                    "/upload-sessions",
                    """{"filename":"a","contentType":"text/plain","byteSize":-1,"handlingMode":"DOCUMENT"}""",
                ).statusCode(),
            )
        }

        @Test
        fun `upload session stays open when the uploaded object is missing`() {
            val session =
                mapper.readTree(
                    request(
                        "POST",
                        "/upload-sessions",
                        """{"filename":"missing.txt","contentType":"text/plain","byteSize":5,"handlingMode":"DOCUMENT"}""",
                    ).body(),
                )
            val completion =
                request(
                    "POST",
                    "/upload-sessions/${session["sessionId"].stringValue()}/complete",
                    "{}",
                )
            assertEquals(
                409,
                completion.statusCode(),
                completion.body(),
            )
            assertEquals(
                "UPLOAD_NOT_FOUND",
                mapper.readTree(completion.body())["code"].stringValue(),
            )
            assertEquals(
                "CREATED",
                mapper
                    .readTree(
                        request(
                            "GET",
                            "/upload-sessions/${session["sessionId"].stringValue()}",
                        ).body(),
                    )["status"]
                    .stringValue(),
            )
        }

        @Test
        fun `discarded file asset deletes current and late asset variants`() {
            val command = preparationCommand()
            val assetId = command["assetId"].stringValue()
            deliverPreparationEvent(
                "asset.preparation.failed.v1",
                preparationFailedEvent(command, "RETRY_EXHAUSTED"),
            )
            s3.putObject(
                {
                    it.bucket("prepared-assets").key(command["destinationPrefix"].stringValue() + "partial")
                },
                RequestBody.fromString("partial"),
            )
            clock.advance(Duration.ofHours(25))
            assertTrue(cleanup.runCleanup() >= 1)
            assertEquals(
                "DISCARDED",
                mapper
                    .readTree(
                        request(
                            "GET",
                            "/assets/$assetId",
                        ).body(),
                    )["status"]
                    .stringValue(),
            )
            assertTrue(assetVariantObjects(command).isNotEmpty())
            publication.publishPending()
            Awaitility.await().atMost(Duration.ofSeconds(10)).untilAsserted {
                assertTrue(assetVariantObjects(command).isEmpty())
            }

            s3.putObject(
                {
                    it.bucket("prepared-assets").key(command["destinationPrefix"].stringValue() + "late")
                },
                RequestBody.fromString("late"),
            )
            deliverPreparationEvent(
                "asset.preparation.completed.v1",
                preparationCompletedEvent(command),
            )
            publication.publishPending()
            Awaitility.await().atMost(Duration.ofSeconds(10)).untilAsserted {
                assertTrue(assetVariantObjects(command).isEmpty())
            }
        }

        private fun assetVariantObjects(command: JsonNode) =
            s3
                .listObjectsV2 {
                    it.bucket("prepared-assets").prefix(command["destinationPrefix"].stringValue())
                }.contents()

        private fun preparationCommand(): JsonNode = mapper.readTree(receivePreparationCommand().body)

        private fun receivePreparationCommand(): Message {
            val session =
                mapper.readTree(
                    request(
                        "POST",
                        "/upload-sessions",
                        """{"filename":"event.txt","contentType":"text/plain","byteSize":5,"handlingMode":"DOCUMENT"}""",
                    ).body(),
                )
            client.send(
                HttpRequest
                    .newBuilder(URI(session["upload"]["url"].stringValue()))
                    .header(
                        "Content-Type",
                        "text/plain",
                    ).PUT(HttpRequest.BodyPublishers.ofString("hello"))
                    .build(),
                HttpResponse.BodyHandlers.ofString(),
            )
            assertEquals(
                202,
                request(
                    "POST",
                    "/upload-sessions/${session["sessionId"].stringValue()}/complete",
                    "{}",
                ).statusCode(),
            )
            publication.publishPending()
            while (true) {
                val received =
                    rabbit.receive(
                        "document.jobs",
                        5000,
                    )
                val message = requireNotNull(received)
                val command = mapper.readTree(message.body)
                if (command["assetId"].stringValue() == session["assetId"].stringValue()) {
                    return message
                }
            }
        }

        private fun preparationCompletedEvent(
            command: JsonNode,
            key: String = command["destinationPrefix"].stringValue() + "original",
        ): Map<String, Any> {
            val preparationStartedAt = command["preparationStartedAt"].stringValue()
            val started = OffsetDateTime.parse(preparationStartedAt)
            return mapOf(
                "commandId" to command["commandId"].stringValue(),
                "assetId" to command["assetId"].stringValue(),
                "preparationStartedAt" to preparationStartedAt,
                "workerStartedAt" to started.plusSeconds(1).toString(),
                "workerFinishedAt" to started.plusSeconds(2).toString(),
                "variants" to
                    listOf(
                        mapOf(
                            "variantType" to "ORIGINAL",
                            "bucket" to "prepared-assets",
                            "objectKey" to key,
                            "contentType" to "text/plain",
                            "byteSize" to 5,
                        ),
                    ),
            )
        }

        private fun preparationFailedEvent(
            command: JsonNode,
            failureCode: String,
        ): Map<String, Any> {
            val preparationStartedAt = command["preparationStartedAt"].stringValue()
            val started = OffsetDateTime.parse(preparationStartedAt)
            return mapOf(
                "commandId" to command["commandId"].stringValue(),
                "assetId" to command["assetId"].stringValue(),
                "preparationStartedAt" to preparationStartedAt,
                "workerStartedAt" to started.plusSeconds(1).toString(),
                "workerFinishedAt" to started.plusSeconds(2).toString(),
                "failureCode" to failureCode,
            )
        }

        private fun deliverPreparationEvent(
            key: String,
            payload: Any,
            reject: Boolean = false,
        ) {
            val channel = Mockito.mock(Channel::class.java)
            val headers =
                MessageProperties().apply {
                    receivedRoutingKey = key
                    deliveryTag = 1
                    contentType = "application/json"
                }
            listener.onPreparationEvent(
                Message(
                    mapper.writeValueAsBytes(payload),
                    headers,
                ),
                channel,
            )
            if (reject) {
                Mockito.verify(channel).basicReject(
                    1,
                    false,
                )
            } else {
                Mockito.verify(channel).basicAck(
                    1,
                    false,
                )
            }
        }

        @Test
        fun `completion event makes the file asset ready`() {
            val command = preparationCommand()
            val event = preparationCompletedEvent(command)
            val payload =
                Message(
                    mapper.writeValueAsBytes(event),
                    MessageProperties().apply { contentType = "application/json" },
                )
            rabbit.send(
                "asset.events",
                "asset.preparation.completed.v1",
                payload,
            )
            val path = "/assets/${command["assetId"].stringValue()}"
            Awaitility.await().atMost(Duration.ofSeconds(10)).untilAsserted {
                val asset =
                    mapper.readTree(
                        request(
                            "GET",
                            path,
                        ).body(),
                    )
                assertEquals(
                    "READY",
                    asset["status"].stringValue(),
                )
                assertEquals(
                    1,
                    asset["variants"].size(),
                )
                assertTrue(
                    asset["variants"][0]["url"].stringValue().contains("/prepared-assets/assets/"),
                )
                assertTrue(asset["variants"][0]["url"].stringValue().endsWith("/original"))
            }
        }

        @Test
        fun `completed upload session sends one durable preparation command`() {
            val received = receivePreparationCommand()
            val command = mapper.readTree(received.body)
            assertEquals(
                command["commandId"].stringValue(),
                received.messageProperties.messageId,
            )
            assertEquals(
                "application/json",
                received.messageProperties.contentType,
            )
            assertEquals(
                MessageDeliveryMode.PERSISTENT,
                received.messageProperties.receivedDeliveryMode,
            )
            assertTrue(received.messageProperties.timestamp != null)
            assertEquals(
                5,
                command["sourceByteSize"].intValue(),
            )
            assertTrue(command["sourceObjectEtag"].stringValue().isNotBlank())
            assertEquals(
                0,
                publication.publishPending(),
            )
        }

        @Test
        fun `prometheus endpoint exposes API and upload metrics`() {
            val created = request(
                "POST",
                "/upload-sessions",
                """{"filename":"metrics.txt","contentType":"text/plain","byteSize":5,"handlingMode":"DOCUMENT"}""",
            )
            assertEquals(201, created.statusCode(), created.body())
            val unauthorized = client.send(
                HttpRequest.newBuilder(URI("http://localhost:$port/api/actuator/prometheus")).GET().build(),
                HttpResponse.BodyHandlers.ofString(),
            )
            assertEquals(401, unauthorized.statusCode(), unauthorized.body())

            val credentials = Base64.getEncoder().encodeToString("metrics:metrics-local".toByteArray())
            val response = client.send(
                HttpRequest
                    .newBuilder(URI("http://localhost:$port/api/actuator/prometheus"))
                    .header("Authorization", "Basic $credentials")
                    .GET()
                    .build(),
                HttpResponse.BodyHandlers.ofString(),
            )

            assertEquals(200, response.statusCode(), response.body())
            assertTrue(response.headers().firstValue("Content-Type").orElse("").startsWith("text/plain"))
            assertTrue(response.body().contains("http_server_requests_seconds"))
            assertTrue(response.body().contains("file_upload_session_events_total"))
            assertTrue(response.body().contains("file_upload_accepted_bytes_total"))
            assertTrue(response.body().contains("file_upload_completed_bytes_total"))
            assertTrue(response.body().contains("file_upload_preparation_dispatch_duration_seconds"))
            assertTrue(response.body().contains("file_upload_preparation_result_delivery_duration_seconds"))
        }

        @Test
        fun `expired multipart session rejects signed URLs and aborts the transfer`() {
            val session =
                mapper.readTree(
                    request(
                        "POST",
                        "/upload-sessions",
                        """{"filename":"old.bin","contentType":"application/octet-stream","byteSize":100,"handlingMode":"DOCUMENT"}""",
                    ).body(),
                )
            val path = "/upload-sessions/${session["sessionId"].stringValue()}"
            clock.advance(Duration.ofHours(7))
            assertEquals(
                409,
                request(
                    "POST",
                    "$path/parts",
                    """{"partNumbers":[1]}""",
                ).statusCode(),
            )
            expiration.runExpiration()
            assertEquals(
                "EXPIRED",
                mapper
                    .readTree(
                        request(
                            "GET",
                            path,
                        ).body(),
                    )["status"]
                    .stringValue(),
            )
            assertEquals(
                "UPLOAD_EXPIRED",
                mapper
                    .readTree(
                        request(
                            "GET",
                            "/assets/${session["assetId"].stringValue()}",
                        ).body(),
                    )[
                    "failureCode",
                ].stringValue(),
            )
            assertTrue(
                s3
                    .listMultipartUploads { it.bucket("uploads") }
                    .uploads()
                    .any { it.key().contains(session["assetId"].stringValue()) },
            )
            publication.publishPending()
            Awaitility.await().atMost(Duration.ofSeconds(10)).untilAsserted {
                assertTrue(
                    s3
                        .listMultipartUploads { it.bucket("uploads") }
                        .uploads()
                        .none { it.key().contains(session["assetId"].stringValue()) },
                )
            }
        }

        @Test
        fun `aborted upload session stays aborted`() {
            val session =
                mapper.readTree(
                    request(
                        "POST",
                        "/upload-sessions",
                        """{"filename":"large.bin","contentType":"application/octet-stream","byteSize":100,"handlingMode":"DOCUMENT"}""",
                    ).body(),
                )
            val path = "/upload-sessions/${session["sessionId"].stringValue()}"
            val aborted =
                request(
                    "POST",
                    "$path/abort",
                )
            assertEquals(
                200,
                aborted.statusCode(),
                aborted.body(),
            )
            assertEquals(
                "ABORTED",
                mapper.readTree(aborted.body())["status"].stringValue(),
            )
            assertEquals(
                aborted.body(),
                request(
                    "POST",
                    "$path/abort",
                ).body(),
            )
            assertEquals(
                409,
                request(
                    "POST",
                    "$path/complete",
                    "{}",
                ).statusCode(),
            )
            val asset =
                mapper.readTree(
                    request(
                        "GET",
                        "/assets/${session["assetId"].stringValue()}",
                    ).body(),
                )
            assertEquals(
                "FAILED",
                asset["status"].stringValue(),
            )
            assertEquals(
                "UPLOAD_ABORTED",
                asset["failureCode"].stringValue(),
            )
            assertTrue(
                s3
                    .listMultipartUploads { it.bucket("uploads") }
                    .uploads()
                    .none { it.key().contains(session["assetId"].stringValue()) },
            )
        }

        @Test
        fun `multipart upload session accepts parts in separate batches`() {
            val created =
                request(
                    "POST",
                    "/upload-sessions",
                    """{"filename":"large.bin","contentType":"application/octet-stream","byteSize":5242883,"handlingMode":"DOCUMENT"}""",
                )
            assertEquals(
                201,
                created.statusCode(),
                created.body(),
            )
            val session = mapper.readTree(created.body())
            assertEquals(
                "MULTIPART",
                session["strategy"].stringValue(),
            )
            val path = "/upload-sessions/${session["sessionId"].stringValue()}"
            val parts =
                listOf(
                    1 to ByteArray(5242880) { 7 },
                    2 to
                        byteArrayOf(
                            1,
                            2,
                            3,
                        ),
                ).map { (number, bytes) ->
                    val signed =
                        request(
                            "POST",
                            "$path/parts",
                            """{"partNumbers":[$number]}""",
                        )
                    assertEquals(
                        200,
                        signed.statusCode(),
                        signed.body(),
                    )
                    val url = mapper.readTree(signed.body())["parts"][0]["upload"]["url"].stringValue()
                    val uploaded =
                        client.send(
                            HttpRequest.newBuilder(URI(url)).PUT(HttpRequest.BodyPublishers.ofByteArray(bytes)).build(),
                            HttpResponse.BodyHandlers.ofString(),
                        )
                    assertEquals(
                        200,
                        uploaded.statusCode(),
                        uploaded.body(),
                    )
                    mapOf(
                        "partNumber" to number,
                        "etag" to uploaded.headers().firstValue("ETag").orElseThrow(),
                    )
                }
            val completed =
                request(
                    "POST",
                    "$path/complete",
                    mapper.writeValueAsString(mapOf("parts" to parts)),
                )
            assertEquals(
                202,
                completed.statusCode(),
                completed.body(),
            )
            assertEquals(
                "PREPARING",
                mapper.readTree(completed.body())["status"].stringValue(),
            )
            assertEquals(
                completed.body(),
                request(
                    "POST",
                    "$path/complete",
                    mapper.writeValueAsString(mapOf("parts" to parts)),
                ).body(),
            )
        }

        @Test
        fun `single upload session completes once`() {
            val created =
                request(
                    "POST",
                    "/upload-sessions",
                    """{"filename":"notes.txt","contentType":"text/plain","byteSize":5,"handlingMode":"DOCUMENT"}""",
                )
            val session = mapper.readTree(created.body())
            val put =
                HttpRequest
                    .newBuilder(URI(session["upload"]["url"].stringValue()))
                    .header(
                        "Content-Type",
                        "text/plain",
                    ).PUT(HttpRequest.BodyPublishers.ofString("hello"))
                    .build()
            val uploaded =
                client.send(
                    put,
                    HttpResponse.BodyHandlers.ofString(),
                )
            assertEquals(
                200,
                uploaded.statusCode(),
                uploaded.body(),
            )
            val path = "/upload-sessions/${session["sessionId"].stringValue()}/complete"
            val completed =
                request(
                    "POST",
                    path,
                    "{}",
                )
            assertEquals(
                202,
                completed.statusCode(),
                completed.body(),
            )
            assertEquals(
                "PREPARING",
                mapper.readTree(completed.body())["status"].stringValue(),
            )
            assertEquals(
                completed.body(),
                request(
                    "POST",
                    path,
                    "{}",
                ).body(),
            )
            assertEquals(
                "COMPLETED",
                mapper
                    .readTree(
                        request(
                            "GET",
                            "/upload-sessions/${session["sessionId"].stringValue()}",
                        ).body(),
                    )["status"]
                    .stringValue(),
            )
        }

        @Test
        fun `new upload session returns instructions for its file asset`() {
            val created =
                request(
                    "POST",
                    "/upload-sessions",
                    """{"filename":"notes.txt","contentType":"text/plain","byteSize":5,"handlingMode":"DOCUMENT"}""",
                )
            assertEquals(
                201,
                created.statusCode(),
                created.body(),
            )
            val session = mapper.readTree(created.body())
            assertEquals(
                "SINGLE",
                session["strategy"].stringValue(),
            )
            assertTrue(session["upload"]["url"].stringValue().contains("X-Amz-Signature"))
            val asset =
                request(
                    "GET",
                    "/assets/${session["assetId"].stringValue()}",
                )
            assertEquals(
                200,
                asset.statusCode(),
                asset.body(),
            )
            assertEquals(
                "AWAITING_UPLOAD",
                mapper.readTree(asset.body())["status"].stringValue(),
            )
            val foreign =
                request(
                    "GET",
                    "/assets/${session["assetId"].stringValue()}",
                    userId = UlidCreator.getMonotonicUlid().toString(),
                )
            assertEquals(
                404,
                foreign.statusCode(),
            )
            val fetched =
                request(
                    "GET",
                    "/upload-sessions/${session["sessionId"].stringValue()}",
                )
            assertEquals(
                200,
                fetched.statusCode(),
                fetched.body(),
            )
        }

        private fun request(
            method: String,
            path: String,
            body: String? = null,
            key: String = UlidCreator.getMonotonicUlid().toString(),
            userId: String = user,
        ): HttpResponse<String> {
            val builder =
                HttpRequest
                    .newBuilder(URI("http://localhost:$port/api/v1$path"))
                    .header(
                        "X-User-ID",
                        userId,
                    ).header(
                        "Idempotency-Key",
                        key,
                    ).header(
                        "Content-Type",
                        "application/json",
                    ).method(
                        method,
                        body?.let(HttpRequest.BodyPublishers::ofString) ?: HttpRequest.BodyPublishers.noBody(),
                    )
            return client.send(
                builder.build(),
                HttpResponse.BodyHandlers.ofString(),
            )
        }
    }
