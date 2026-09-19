package com.andrewtinyakov.fileupload.asset.messaging.listener

import com.andrewtinyakov.fileupload.asset.integration.ObjectStorage
import com.andrewtinyakov.fileupload.asset.messaging.command.DeleteAssetPrefixCommandV1
import com.andrewtinyakov.fileupload.infrastructure.messaging.AssetMessaging.Queues.ASSET_CLEANUPS
import com.andrewtinyakov.fileupload.infrastructure.messaging.consumeMessage
import com.rabbitmq.client.Channel
import org.slf4j.LoggerFactory
import org.springframework.amqp.core.Message
import org.springframework.amqp.rabbit.annotation.RabbitListener
import org.springframework.stereotype.Component
import tools.jackson.databind.ObjectMapper

@Component
class AssetCleanupListener(
    private val storage: ObjectStorage,
    mapper: ObjectMapper,
) {
    private val reader = mapper.readerFor(DeleteAssetPrefixCommandV1::class.java)

    private val logger = LoggerFactory.getLogger(javaClass)

    @RabbitListener(
        queues = [ASSET_CLEANUPS],
        concurrency = $$"${file-upload.messaging.asset-cleanup-concurrency:4}",
    )
    fun onCleanupCommand(
        message: Message,
        channel: Channel,
    ) = consumeMessage(
        message = message,
        channel = channel,
        logger = logger,
    ) {
        val command: DeleteAssetPrefixCommandV1 = reader.readValue(message.body)
        require(command.bucket.isNotBlank())
        require(command.prefix.isNotBlank() && command.prefix.endsWith('/'))
        storage.deleteByPrefix(
            bucket = command.bucket,
            prefix = command.prefix,
        )
    }
}
