package com.andrewtinyakov.fileupload.asset.messaging.publisher

import com.andrewtinyakov.fileupload.asset.messaging.command.PrepareDocumentCommandV1
import com.andrewtinyakov.fileupload.asset.messaging.command.PrepareImageCommandV1
import com.andrewtinyakov.fileupload.asset.model.FileAsset
import com.andrewtinyakov.fileupload.asset.model.HandlingMode
import com.andrewtinyakov.fileupload.asset.model.UploadSession
import com.andrewtinyakov.fileupload.infrastructure.messaging.AssetMessaging.Routes.PREPARE_DOCUMENT
import com.andrewtinyakov.fileupload.infrastructure.messaging.AssetMessaging.Routes.PREPARE_IMAGE
import com.andrewtinyakov.fileupload.infrastructure.outbox.OutboxService
import com.andrewtinyakov.fileupload.shared.id.UlidGenerator
import org.springframework.stereotype.Component
import java.time.OffsetDateTime

@Component
class AssetPreparationPublisher(
    private val outboxService: OutboxService,
    private val ulidGenerator: UlidGenerator,
) {
    fun enqueuePreparation(
        asset: FileAsset,
        session: UploadSession,
        etag: String,
        preparationStartedAt: OffsetDateTime,
    ) {
        val id = ulidGenerator.generate()
        val processingProfileName = asset.processingProfileName
        val processingProfileVersion = asset.processingProfileVersion
        when (asset.handlingMode) {
            HandlingMode.DOCUMENT -> {
                outboxService.enqueue(
                    id = id,
                    aggregateType = FileAsset::class,
                    aggregateId = asset.id.value,
                    route = PREPARE_DOCUMENT,
                    payload = PrepareDocumentCommandV1(
                        commandId = id,
                        assetId = asset.id.value,
                        preparationStartedAt = preparationStartedAt,
                        sourceBucket = session.bucket,
                        sourceObjectKey = session.objectKey,
                        sourceContentType = asset.contentType,
                        sourceByteSize = asset.byteSize,
                        sourceObjectEtag = etag,
                        destinationBucket = asset.bucket,
                        destinationPrefix = asset.prefix,
                    ),
                )
            }

            HandlingMode.IMAGE -> {
                outboxService.enqueue(
                    id = id,
                    aggregateType = FileAsset::class,
                    aggregateId = asset.id.value,
                    route = PREPARE_IMAGE,
                    payload = PrepareImageCommandV1(
                        commandId = id,
                        assetId = asset.id.value,
                        preparationStartedAt = preparationStartedAt,
                        sourceBucket = session.bucket,
                        sourceObjectKey = session.objectKey,
                        sourceContentType = asset.contentType,
                        sourceByteSize = asset.byteSize,
                        sourceObjectEtag = etag,
                        destinationBucket = asset.bucket,
                        destinationPrefix = asset.prefix,
                        processingProfileName = requireNotNull(processingProfileName),
                        processingProfileVersion = requireNotNull(processingProfileVersion),
                    ),
                )
            }
        }
    }
}
