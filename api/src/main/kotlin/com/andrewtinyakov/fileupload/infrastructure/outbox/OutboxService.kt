package com.andrewtinyakov.fileupload.infrastructure.outbox

import com.andrewtinyakov.fileupload.infrastructure.config.SchedulingProperties
import com.andrewtinyakov.fileupload.infrastructure.messaging.MessageRoute
import org.springframework.amqp.core.Message
import org.springframework.amqp.core.MessageDeliveryMode
import org.springframework.amqp.core.MessageProperties
import org.springframework.amqp.rabbit.connection.CorrelationData
import org.springframework.amqp.rabbit.core.RabbitTemplate
import org.springframework.stereotype.Service
import org.springframework.transaction.support.TransactionTemplate
import tools.jackson.databind.ObjectMapper
import java.time.Clock
import java.time.OffsetDateTime
import java.util.Date
import kotlin.reflect.KClass

@Service
class OutboxService(
    private val repository: OutboxRepository,
    private val tx: TransactionTemplate,
    private val rabbit: RabbitTemplate,
    private val schedulingProperties: SchedulingProperties,
    private val config: OutboxConfig,
    private val clock: Clock,
    private val mapper: ObjectMapper,
) {
    fun enqueue(
        id: String,
        aggregateType: KClass<*>,
        aggregateId: String,
        route: MessageRoute,
        payload: Any,
    ) = enqueue(
        listOf(
            createMessage(
                id = id,
                aggregateType = aggregateType,
                aggregateId = aggregateId,
                route = route,
                payload = payload,
            ),
        ),
    )

    fun enqueue(messages: Collection<OutboxMessage>) = repository.enqueue(messages)

    fun createMessage(
        id: String,
        aggregateType: KClass<*>,
        aggregateId: String,
        route: MessageRoute,
        payload: Any,
    ): OutboxMessage = OutboxMessage(
        id = id,
        aggregateType = requireNotNull(aggregateType.simpleName),
        aggregateId = aggregateId,
        exchange = route.exchange,
        routingKey = route.routingKey,
        type = payload.javaClass.simpleName.also { require(it.isNotBlank()) },
        payload = mapper.writeValueAsString(payload),
        status = OutboxMessageStatus.PENDING,
    )

    fun publishPending(): Int {
        var published = 0
        repeat(config.maxBatchesPerRun) {
            val batchSize = publishBatch()
            published += batchSize
            if (batchSize < schedulingProperties.batchSize) {
                return published
            }
        }
        return published
    }

    private fun publishBatch(): Int =
        tx.execute {
            val messages = repository.findUnpublishedForUpdate(schedulingProperties.batchSize)
            if (messages.isEmpty()) {
                return@execute 0
            }
            check(messages.all { it.status == OutboxMessageStatus.PENDING })
            val correlations = rabbit.invoke { operations ->
                val sent = messages.map { message ->
                    CorrelationData(message.id).also { correlation ->
                        val headers = MessageProperties().apply {
                            contentType = "application/json"
                            messageId = message.id
                            type = message.type
                            deliveryMode = MessageDeliveryMode.PERSISTENT
                            timestamp = Date.from(clock.instant())
                        }
                        operations.send(
                            message.exchange,
                            message.routingKey,
                            Message(
                                message.payload.toByteArray(Charsets.UTF_8),
                                headers,
                            ),
                            correlation,
                        )
                    }
                }
                operations.waitForConfirmsOrDie(config.confirmTimeout.toMillis())
                sent
            }
            correlations.forEach { correlation ->
                check(correlation.returned == null) {
                    "Outbox publication ${correlation.id} was unroutable"
                }
            }
            repository.markPublished(
                messages.map(OutboxMessage::id),
                OffsetDateTime.now(clock),
            )
            messages.size
        }
}
