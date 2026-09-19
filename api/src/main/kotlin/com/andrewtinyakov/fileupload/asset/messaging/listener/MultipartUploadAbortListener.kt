package com.andrewtinyakov.fileupload.asset.messaging.listener

import com.andrewtinyakov.fileupload.asset.integration.ObjectStorage
import com.andrewtinyakov.fileupload.asset.messaging.command.AbortMultipartUploadCommandV1
import com.andrewtinyakov.fileupload.infrastructure.messaging.AssetMessaging.Queues.MULTIPART_ABORTS
import com.andrewtinyakov.fileupload.infrastructure.messaging.consumeMessage
import com.rabbitmq.client.Channel
import org.slf4j.LoggerFactory
import org.springframework.amqp.core.Message
import org.springframework.amqp.rabbit.annotation.RabbitListener
import org.springframework.stereotype.Component
import tools.jackson.databind.ObjectMapper

@Component
class MultipartUploadAbortListener(
    private val storage: ObjectStorage,
    mapper: ObjectMapper,
) {
    private val reader = mapper.readerFor(AbortMultipartUploadCommandV1::class.java)

    private val logger = LoggerFactory.getLogger(javaClass)

    @RabbitListener(
        queues = [MULTIPART_ABORTS],
        concurrency = $$"${file-upload.messaging.multipart-abort-concurrency:4}",
    )
    fun onAbortCommand(
        message: Message,
        channel: Channel,
    ) = consumeMessage(
        message = message,
        channel = channel,
        logger = logger,
    ) {
        val command: AbortMultipartUploadCommandV1 = reader.readValue(message.body)
        require(command.bucket.isNotBlank())
        require(command.objectKey.isNotBlank())
        require(command.uploadId.isNotBlank())
        storage.abortMultipart(
            bucket = command.bucket,
            objectKey = command.objectKey,
            uploadId = command.uploadId,
        )
    }
}
