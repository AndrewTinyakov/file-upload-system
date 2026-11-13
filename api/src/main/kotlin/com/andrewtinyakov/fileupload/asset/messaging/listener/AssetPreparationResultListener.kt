package com.andrewtinyakov.fileupload.asset.messaging.listener

import com.andrewtinyakov.fileupload.asset.messaging.command.PrepareDocumentCommandV1
import com.andrewtinyakov.fileupload.asset.messaging.command.PrepareImageCommandV1
import com.andrewtinyakov.fileupload.asset.messaging.event.AssetPreparationCompletedEventV1
import com.andrewtinyakov.fileupload.asset.messaging.event.AssetPreparationFailedEventV1
import com.andrewtinyakov.fileupload.asset.model.FileAssetId
import com.andrewtinyakov.fileupload.asset.service.AssetPreparationService
import com.andrewtinyakov.fileupload.infrastructure.messaging.AssetMessaging.Queues.ASSET_EVENTS
import com.andrewtinyakov.fileupload.infrastructure.messaging.AssetMessaging.Queues.PREPARATION_DEAD
import com.andrewtinyakov.fileupload.infrastructure.messaging.AssetMessaging.RoutingKeys.PREPARATION_COMPLETED
import com.andrewtinyakov.fileupload.infrastructure.messaging.AssetMessaging.RoutingKeys.PREPARATION_FAILED
import com.andrewtinyakov.fileupload.infrastructure.messaging.AssetMessaging.RoutingKeys.PREPARE_DOCUMENT
import com.andrewtinyakov.fileupload.infrastructure.messaging.AssetMessaging.RoutingKeys.PREPARE_IMAGE
import com.andrewtinyakov.fileupload.infrastructure.messaging.consumeMessage
import com.andrewtinyakov.fileupload.shared.monitoring.SampledUploadTrace
import com.rabbitmq.client.Channel
import org.slf4j.LoggerFactory
import org.springframework.amqp.core.Message
import org.springframework.amqp.rabbit.annotation.RabbitListener
import org.springframework.stereotype.Component
import tools.jackson.databind.ObjectMapper
import java.time.Clock
import java.time.OffsetDateTime

@Component
class AssetPreparationResultListener(
    private val assetPreparationService: AssetPreparationService,
    mapper: ObjectMapper,
    private val clock: Clock,
) {
    private val reader = mapper.reader()

    private val logger = LoggerFactory.getLogger(javaClass)

    @RabbitListener(queues = [ASSET_EVENTS])
    fun onPreparationEvent(
        message: Message,
        channel: Channel,
    ) = consumeMessage(
        message = message,
        channel = channel,
        logger = logger,
    ) {
        val receivedAt = OffsetDateTime.now(clock)
        when (message.messageProperties.receivedRoutingKey) {
            PREPARATION_COMPLETED -> {
                val event: AssetPreparationCompletedEventV1 = reader
                    .forType(AssetPreparationCompletedEventV1::class.java)
                    .readValue(message.body)
                assetPreparationService.completePreparation(
                    event,
                    receivedAt,
                )
                SampledUploadTrace.record(event.assetId, "preparation_result_applied")
            }

            PREPARATION_FAILED -> {
                val event: AssetPreparationFailedEventV1 = reader
                    .forType(AssetPreparationFailedEventV1::class.java)
                    .readValue(message.body)
                assetPreparationService.failPreparation(event, receivedAt)
            }

            else -> {
                throw IllegalArgumentException("Unknown asset event routing key")
            }
        }
    }

    @RabbitListener(queues = [PREPARATION_DEAD])
    fun onDeadLetterCommand(
        message: Message,
        channel: Channel,
    ) = consumeMessage(
        message = message,
        channel = channel,
        logger = logger,
    ) {
        val deaths = message.messageProperties.headers["x-death"] as? List<*>
        require(
            deaths?.any { (it as? Map<*, *>)?.get("reason")?.toString() == "delivery_limit" } == true,
        ) {
            "Command did not exhaust its delivery limit"
        }
        when (message.messageProperties.receivedRoutingKey) {
            PREPARE_DOCUMENT -> {
                val command: PrepareDocumentCommandV1 = reader
                    .forType(PrepareDocumentCommandV1::class.java)
                    .readValue(message.body)
                assetPreparationService.failPreparation(
                    assetId = FileAssetId(command.assetId),
                    failureCode = "RETRY_EXHAUSTED",
                )
            }

            PREPARE_IMAGE -> {
                val command: PrepareImageCommandV1 = reader
                    .forType(PrepareImageCommandV1::class.java)
                    .readValue(message.body)
                assetPreparationService.failPreparation(
                    assetId = FileAssetId(command.assetId),
                    failureCode = "RETRY_EXHAUSTED",
                )
            }

            else -> {
                throw IllegalArgumentException("Unknown dead command routing key")
            }
        }
    }
}
