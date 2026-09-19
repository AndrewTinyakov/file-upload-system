package com.andrewtinyakov.fileupload.asset.messaging.publisher

import com.andrewtinyakov.fileupload.asset.messaging.command.AbortMultipartUploadCommandV1
import com.andrewtinyakov.fileupload.asset.model.UploadSession
import com.andrewtinyakov.fileupload.infrastructure.messaging.AssetMessaging.Routes.ABORT_MULTIPART_UPLOAD
import com.andrewtinyakov.fileupload.infrastructure.outbox.OutboxService
import org.springframework.stereotype.Component

@Component
class MultipartUploadAbortPublisher(
    private val outboxService: OutboxService,
) {
    fun enqueueAborts(commands: Collection<AbortMultipartUploadCommandV1>) {
        val messages = commands.map { command ->
            outboxService.createMessage(
                id = command.commandId,
                aggregateType = UploadSession::class,
                aggregateId = command.uploadSessionId,
                route = ABORT_MULTIPART_UPLOAD,
                payload = command,
            )
        }
        outboxService.enqueue(messages)
    }
}
