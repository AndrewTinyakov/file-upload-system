package com.andrewtinyakov.fileupload.asset.service

import com.andrewtinyakov.fileupload.asset.messaging.publisher.AssetCleanupPublisher
import com.andrewtinyakov.fileupload.asset.model.FileAsset
import com.andrewtinyakov.fileupload.asset.repository.FileAssetRepository
import com.andrewtinyakov.fileupload.infrastructure.config.SchedulingProperties
import org.springframework.stereotype.Service
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.time.OffsetDateTime

@Service
class AssetCleanupService(
    private val assetRepository: FileAssetRepository,
    private val cleanupPublisher: AssetCleanupPublisher,
    private val tx: TransactionTemplate,
    private val properties: SchedulingProperties,
    private val clock: Clock,
) {
    fun requestFailedAssetCleanup(): Int {
        var requested = 0
        repeat(properties.maxBatchesPerRun) {
            val batchSize = requestCleanupBatch()
            requested += batchSize
            if (batchSize < properties.batchSize) {
                return requested
            }
        }
        return requested
    }

    private fun requestCleanupBatch(): Int =
        tx.execute {
            val now = OffsetDateTime.now(clock)
            val candidates = assetRepository.findCleanupCandidatesForUpdate(
                cutoff = now.minus(properties.cleanupGracePeriod),
                limit = properties.batchSize,
            )
            assetRepository.requestCleanup(
                ids = candidates.map(FileAsset::id),
                now = now,
            )
            cleanupPublisher.enqueueCleanup(assets = candidates)
            candidates.size
        }
}
