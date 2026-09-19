package com.andrewtinyakov.fileupload.asset.messaging.publisher

import com.andrewtinyakov.fileupload.asset.messaging.command.DeleteAssetPrefixCommandV1
import com.andrewtinyakov.fileupload.asset.model.FileAsset
import com.andrewtinyakov.fileupload.infrastructure.messaging.AssetMessaging.Routes.DELETE_ASSET_PREFIX
import com.andrewtinyakov.fileupload.infrastructure.outbox.OutboxService
import com.andrewtinyakov.fileupload.shared.id.UlidGenerator
import org.springframework.stereotype.Component

@Component
class AssetCleanupPublisher(
    private val outboxService: OutboxService,
    private val ulidGenerator: UlidGenerator,
) {
    fun enqueueCleanup(assets: Collection<FileAsset>) {
        val messages = assets.map { asset ->
            val id = ulidGenerator.generate()
            outboxService.createMessage(
                id = id,
                aggregateType = FileAsset::class,
                aggregateId = asset.id.value,
                route = DELETE_ASSET_PREFIX,
                payload = DeleteAssetPrefixCommandV1(
                    commandId = id,
                    assetId = asset.id.value,
                    bucket = asset.bucket,
                    prefix = asset.prefix,
                ),
            )
        }
        outboxService.enqueue(messages)
    }
}
