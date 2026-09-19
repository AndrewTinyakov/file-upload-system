package com.andrewtinyakov.fileupload.asset.service

import com.andrewtinyakov.fileupload.asset.messaging.event.AssetPreparationCompletedEventV1
import com.andrewtinyakov.fileupload.asset.messaging.publisher.AssetCleanupPublisher
import com.andrewtinyakov.fileupload.asset.model.AssetStatus
import com.andrewtinyakov.fileupload.asset.model.FileAsset
import com.andrewtinyakov.fileupload.asset.model.FileAssetId
import com.andrewtinyakov.fileupload.asset.model.toModels
import com.andrewtinyakov.fileupload.asset.repository.AssetVariantRepository
import com.andrewtinyakov.fileupload.asset.repository.FileAssetRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.time.OffsetDateTime

@Service
class AssetPreparationService(
    private val assets: FileAssetRepository,
    private val variants: AssetVariantRepository,
    private val cleanupPublisher: AssetCleanupPublisher,
    private val transactions: TransactionTemplate,
    private val clock: Clock,
) {
    fun completePreparation(
        event: AssetPreparationCompletedEventV1,
    ) = transactions.executeWithoutResult {
        val asset = requireAssetForUpdate(assetId = FileAssetId(event.assetId))
        if (asset.status == AssetStatus.DISCARDED) {
            cleanupPublisher.enqueueCleanup(assets = listOf(asset))
            return@executeWithoutResult
        }
        val prepared = event.toModels(asset = asset)
        if (asset.status == AssetStatus.READY) {
            val persisted = variants.findByAssetId(assetId = asset.id)
            require(persisted.toSet() == prepared.toSet()) {
                "Conflicting completion for a ready asset"
            }
            return@executeWithoutResult
        }
        require(
            asset.status == AssetStatus.PREPARING ||
                (
                    asset.status == AssetStatus.FAILED &&
                        asset.failureCode == "RETRY_EXHAUSTED"
                ),
        ) {
            "Asset cannot accept preparation completion"
        }
        variants.insert(
            assetId = asset.id,
            variants = prepared,
        )
        assets.transitionStatus(
            id = asset.id,
            expected = asset.status,
            next = AssetStatus.READY,
            now = OffsetDateTime.now(clock),
        )
    }

    fun failPreparation(
        assetId: FileAssetId,
        failureCode: String,
    ) = transactions.executeWithoutResult {
        val failureCodePattern = Regex("^[A-Z][A-Z0-9_]*$")
        require(failureCodePattern.matches(failureCode) && failureCode.length <= 255) {
            "Invalid failure code"
        }
        val asset = requireAssetForUpdate(assetId = assetId)
        if (asset.status == AssetStatus.READY ||
            asset.status == AssetStatus.FAILED ||
            asset.status == AssetStatus.DISCARDED
        ) {
            return@executeWithoutResult
        }
        require(asset.status == AssetStatus.PREPARING) { "Asset is not preparing" }
        assets.transitionStatus(
            id = asset.id,
            expected = AssetStatus.PREPARING,
            next = AssetStatus.FAILED,
            now = OffsetDateTime.now(clock),
            failureCode = failureCode,
        )
    }

    private fun requireAssetForUpdate(assetId: FileAssetId): FileAsset {
        val asset = assets.findByIdForUpdate(id = assetId)
        return requireNotNull(asset) { "Unknown asset" }
    }
}
