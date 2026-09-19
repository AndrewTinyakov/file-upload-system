package com.andrewtinyakov.fileupload.infrastructure.messaging

import org.junit.jupiter.api.Test
import org.springframework.amqp.core.Binding
import org.springframework.amqp.core.Queue
import org.springframework.amqp.core.TopicExchange
import kotlin.test.assertEquals

class RabbitConfigTests {
    private val topology = RabbitConfig().assetTopology(MessagingProperties(deliveryLimit = 7))
    private val queues = topology.getDeclarablesByType(Queue::class.java).associateBy(Queue::getName)

    @Test
    fun `asset queues bind to their routes`() {
        val exchanges = topology.getDeclarablesByType(TopicExchange::class.java).map(TopicExchange::getName).toSet()
        val bindings =
            topology
                .getDeclarablesByType(Binding::class.java)
                .map {
                    Triple(
                        it.destination,
                        it.exchange,
                        it.routingKey,
                    )
                }.toSet()

        assertEquals(
            setOf(
                "asset.commands",
                "asset.events",
                "asset.dead",
            ),
            exchanges,
        )
        assertEquals(
            setOf(
                Triple(
                    "backend.asset-cleanups",
                    "asset.commands",
                    "asset.prefix.delete.v1",
                ),
                Triple(
                    "backend.multipart-aborts",
                    "asset.commands",
                    "upload.multipart.abort.v1",
                ),
                Triple(
                    "document.jobs",
                    "asset.commands",
                    "document.prepare.v1",
                ),
                Triple(
                    "image.jobs",
                    "asset.commands",
                    "image.prepare.v1",
                ),
                Triple(
                    "backend.asset-events",
                    "asset.events",
                    "asset.preparation.completed.v1",
                ),
                Triple(
                    "backend.asset-events",
                    "asset.events",
                    "asset.preparation.failed.v1",
                ),
                Triple(
                    "backend.preparation-dead",
                    "asset.dead",
                    "document.prepare.v1",
                ),
                Triple(
                    "backend.preparation-dead",
                    "asset.dead",
                    "image.prepare.v1",
                ),
                Triple(
                    "backend.asset-cleanups-dead",
                    "asset.dead",
                    "asset.prefix.delete.v1",
                ),
                Triple(
                    "backend.multipart-aborts-dead",
                    "asset.dead",
                    "upload.multipart.abort.v1",
                ),
            ),
            bindings,
        )
    }

    @Test
    fun `worker queues retry before they dead letter a message`() {
        val expected =
            mapOf(
                "x-queue-type" to "quorum",
                "x-delivery-limit" to 7,
                "x-dead-letter-exchange" to "asset.dead",
                "x-dead-letter-strategy" to "at-least-once",
                "x-overflow" to "reject-publish",
                "x-delayed-retry-type" to "failed",
                "x-delayed-retry-min" to 1_000,
                "x-delayed-retry-max" to 30_000,
            )

        assertEquals(
            expected,
            queues.getValue("document.jobs").arguments,
        )
        assertEquals(
            expected,
            queues.getValue("image.jobs").arguments,
        )
        assertEquals(
            expected,
            queues.getValue("backend.asset-cleanups").arguments,
        )
        assertEquals(
            expected,
            queues.getValue("backend.multipart-aborts").arguments,
        )
    }

    @Test
    fun `API queues retry until a message succeeds`() {
        val expected =
            mapOf(
                "x-queue-type" to "quorum",
                "x-delivery-limit" to -1,
                "x-delayed-retry-type" to "failed",
                "x-delayed-retry-min" to 1_000,
                "x-delayed-retry-max" to 30_000,
            )

        assertEquals(
            expected,
            queues.getValue("backend.asset-events").arguments,
        )
        assertEquals(
            expected,
            queues.getValue("backend.preparation-dead").arguments,
        )
        assertEquals(
            expected,
            queues.getValue("backend.asset-cleanups-dead").arguments,
        )
        assertEquals(
            expected,
            queues.getValue("backend.multipart-aborts-dead").arguments,
        )
    }
}
