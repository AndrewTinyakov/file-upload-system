package com.andrewtinyakov.fileupload.asset.service

import com.andrewtinyakov.fileupload.asset.messaging.event.AssetPreparationCompletedEventV1
import com.andrewtinyakov.fileupload.asset.messaging.event.AssetPreparationFailedEventV1
import com.andrewtinyakov.fileupload.asset.messaging.publisher.AssetCleanupPublisher
import com.andrewtinyakov.fileupload.asset.model.AssetStatus
import com.andrewtinyakov.fileupload.asset.model.FileAsset
import com.andrewtinyakov.fileupload.asset.model.FileAssetId
import com.andrewtinyakov.fileupload.asset.model.HandlingMode
import com.andrewtinyakov.fileupload.asset.model.toModels
import com.andrewtinyakov.fileupload.asset.monitoring.AssetPreparationMetricsRecorder
import com.andrewtinyakov.fileupload.asset.repository.AssetVariantRepository
import com.andrewtinyakov.fileupload.asset.repository.FileAssetRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.time.OffsetDateTime

@Service
class AssetPreparationService(
    private val assetRepository: FileAssetRepository,
    private val variantRepository: AssetVariantRepository,
    private val cleanupPublisher: AssetCleanupPublisher,
    private val tx: TransactionTemplate,
    private val clock: Clock,
    private val metricsRecorder: AssetPreparationMetricsRecorder,
) {
    fun completePreparation(
        event: AssetPreparationCompletedEventV1,
        receivedAt: OffsetDateTime,
    ) {
        val preparedAsset = tx.execute {
            val asset = requireAssetForUpdate(assetId = FileAssetId(event.assetId))
            if (asset.status == AssetStatus.DISCARDED) {
                cleanupPublisher.enqueueCleanup(assets = listOf(asset))
                return@execute null
            }
            val prepared = event.toModels(asset = asset)
            if (asset.status == AssetStatus.READY) {
                val persisted = variantRepository.findByAssetId(assetId = asset.id)
                require(persisted.toSet() == prepared.toSet()) {
                    "Conflicting completion for a ready asset"
                }
                return@execute null
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
            variantRepository.insert(
                assetId = asset.id,
                variants = prepared,
            )
            val now = OffsetDateTime.now(clock)
            assetRepository.transitionStatus(
                id = asset.id,
                expected = asset.status,
                next = AssetStatus.READY,
                now = now,
            )
            asset
        }
        preparedAsset?.let { completed ->
            metricsRecorder.preparationCompleted(
                handlingMode = completed.handlingMode,
                preparationStartedAt = event.preparationStartedAt,
                workerStartedAt = event.workerStartedAt,
                workerFinishedAt = event.workerFinishedAt,
                receivedAt = receivedAt,
            )
        }
    }

    fun failPreparation(
        event: AssetPreparationFailedEventV1,
        receivedAt: OffsetDateTime,
    ) {
        failPreparation(
            assetId = FileAssetId(event.assetId),
            failureCode = event.failureCode,
            onRecorded = { handlingMode ->
                metricsRecorder.preparationFailed(
                    handlingMode = handlingMode,
                    preparationStartedAt = event.preparationStartedAt,
                    workerStartedAt = event.workerStartedAt,
                    workerFinishedAt = event.workerFinishedAt,
                    receivedAt = receivedAt,
                )
            },
        )
    }

    fun failPreparation(
        assetId: FileAssetId,
        failureCode: String,
    ) {
        failPreparation(
            assetId,
            failureCode,
        ) { handlingMode -> metricsRecorder.preparationFailed(handlingMode) }
    }

    private fun failPreparation(
        assetId: FileAssetId,
        failureCode: String,
        onRecorded: (HandlingMode) -> Unit,
    ) {
        val failedAsset = tx.execute {
            val failureCodePattern = Regex("^[A-Z][A-Z0-9_]*$")
            require(failureCodePattern.matches(failureCode) && failureCode.length <= 255) {
                "Invalid failure code"
            }
            val asset = requireAssetForUpdate(assetId = assetId)
            if (asset.status == AssetStatus.READY ||
                asset.status == AssetStatus.FAILED ||
                asset.status == AssetStatus.DISCARDED
            ) {
                return@execute null
            }
            require(asset.status == AssetStatus.PREPARING) { "Asset is not preparing" }
            val now = OffsetDateTime.now(clock)
            assetRepository.transitionStatus(
                id = asset.id,
                expected = AssetStatus.PREPARING,
                next = AssetStatus.FAILED,
                now = now,
                failureCode = failureCode,
            )
            asset
        }
        failedAsset?.let { failed ->
            onRecorded(failed.handlingMode)
        }
    }

    private fun requireAssetForUpdate(assetId: FileAssetId): FileAsset {
        val asset = assetRepository.findByIdForUpdate(id = assetId)
        return requireNotNull(asset) { "Unknown asset" }
    }
}
