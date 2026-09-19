package com.andrewtinyakov.fileupload.asset.service

import com.andrewtinyakov.fileupload.asset.messaging.command.AbortMultipartUploadCommandV1
import com.andrewtinyakov.fileupload.asset.messaging.publisher.MultipartUploadAbortPublisher
import com.andrewtinyakov.fileupload.asset.model.UploadSession
import com.andrewtinyakov.fileupload.asset.model.UploadStrategy
import com.andrewtinyakov.fileupload.asset.repository.FileAssetRepository
import com.andrewtinyakov.fileupload.asset.repository.UploadSessionRepository
import com.andrewtinyakov.fileupload.infrastructure.config.SchedulingProperties
import com.andrewtinyakov.fileupload.shared.id.UlidGenerator
import org.springframework.stereotype.Service
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.time.OffsetDateTime

@Service
class UploadSessionExpirationService(
    private val sessions: UploadSessionRepository,
    private val assets: FileAssetRepository,
    private val multipartAborts: MultipartUploadAbortPublisher,
    private val transactions: TransactionTemplate,
    private val properties: SchedulingProperties,
    private val ulidGenerator: UlidGenerator,
    private val clock: Clock,
) {
    fun expireSessions(): Int {
        var expired = 0
        repeat(properties.maxBatchesPerRun) {
            val batchSize = expireBatch()
            expired += batchSize
            if (batchSize < properties.batchSize) {
                return expired
            }
        }
        return expired
    }

    private fun expireBatch(): Int = transactions.execute {
        val now = OffsetDateTime.now(clock)
        val expired = sessions.findExpiredForUpdate(
            now = now,
            limit = properties.batchSize,
        )
        sessions.expire(
            ids = expired.map(UploadSession::id),
            now = now,
        )
        assets.failForExpiredUploads(
            ids = expired.map(UploadSession::assetId),
            now = now,
        )
        multipartAborts.enqueueAborts(
            commands = expired.mapNotNull { session ->
                if (session.strategy != UploadStrategy.MULTIPART) {
                    return@mapNotNull null
                }
                AbortMultipartUploadCommandV1(
                    commandId = ulidGenerator.generate(),
                    uploadSessionId = session.id.value,
                    bucket = session.bucket,
                    objectKey = session.objectKey,
                    uploadId = requireNotNull(session.providerUploadId),
                )
            },
        )
        expired.size
    }
}
