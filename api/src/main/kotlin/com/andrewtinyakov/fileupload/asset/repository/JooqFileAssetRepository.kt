package com.andrewtinyakov.fileupload.asset.repository

import com.andrewtinyakov.fileupload.asset.model.AssetStatus
import com.andrewtinyakov.fileupload.asset.model.FileAsset
import com.andrewtinyakov.fileupload.asset.model.FileAssetId
import com.andrewtinyakov.fileupload.asset.model.HandlingMode
import com.andrewtinyakov.fileupload.infrastructure.database.generated.enums.FileAssetStatus
import com.andrewtinyakov.fileupload.infrastructure.database.generated.enums.FileHandlingMode
import com.andrewtinyakov.fileupload.infrastructure.database.generated.tables.FileAssets.FILE_ASSETS
import com.andrewtinyakov.fileupload.infrastructure.database.generated.tables.records.FileAssetsRecord
import com.andrewtinyakov.fileupload.user.UserId
import org.jooq.DSLContext
import org.springframework.stereotype.Repository
import java.time.OffsetDateTime

@Repository
class JooqFileAssetRepository(
    private val db: DSLContext,
) : FileAssetRepository {
    override fun findCleanupCandidatesForUpdate(
        cutoff: OffsetDateTime,
        limit: Int,
    ): List<FileAsset> =
        db
            .selectFrom(FILE_ASSETS)
            .where(
                FILE_ASSETS.STATUS.eq(FileAssetStatus.FAILED),
                FILE_ASSETS.UPDATED_AT.le(cutoff),
            ).orderBy(
                FILE_ASSETS.UPDATED_AT,
                FILE_ASSETS.ID,
            ).limit(limit)
            .forUpdate()
            .skipLocked()
            .fetch()
            .map { it.toModel() }

    override fun requestCleanup(
        ids: Collection<FileAssetId>,
        now: OffsetDateTime,
    ) {
        if (ids.isEmpty()) {
            return
        }
        val updated = db
            .update(FILE_ASSETS)
            .set(
                FILE_ASSETS.STATUS,
                FileAssetStatus.DISCARDED,
            ).set(
                FILE_ASSETS.UPDATED_AT,
                now,
            ).where(
                FILE_ASSETS.ID.`in`(ids.map(FileAssetId::value)),
                FILE_ASSETS.STATUS.eq(FileAssetStatus.FAILED),
            ).execute()
        check(updated == ids.size) {
            "Expected to request cleanup for ${ids.size} assets, updated $updated"
        }
    }

    override fun transitionStatus(
        id: FileAssetId,
        expected: AssetStatus,
        next: AssetStatus,
        now: OffsetDateTime,
        failureCode: String?,
    ) {
        val updated = db
            .update(FILE_ASSETS)
            .set(
                FILE_ASSETS.STATUS,
                FileAssetStatus.valueOf(next.name),
            ).set(
                FILE_ASSETS.FAILURE_CODE,
                failureCode,
            ).set(
                FILE_ASSETS.UPDATED_AT,
                now,
            ).where(
                FILE_ASSETS.ID.eq(id.value),
                FILE_ASSETS.STATUS.eq(FileAssetStatus.valueOf(expected.name)),
            ).execute()
        check(updated == 1)
    }

    override fun failForExpiredUploads(
        ids: Collection<FileAssetId>,
        now: OffsetDateTime,
    ) {
        if (ids.isEmpty()) {
            return
        }
        val updated = db
            .update(FILE_ASSETS)
            .set(
                FILE_ASSETS.STATUS,
                FileAssetStatus.FAILED,
            ).set(
                FILE_ASSETS.FAILURE_CODE,
                "UPLOAD_EXPIRED",
            ).set(
                FILE_ASSETS.UPDATED_AT,
                now,
            ).where(
                FILE_ASSETS.ID.`in`(ids.map(FileAssetId::value)),
                FILE_ASSETS.STATUS.eq(FileAssetStatus.AWAITING_UPLOAD),
            ).execute()
        check(updated == ids.size) {
            "Expected to fail ${ids.size} expired upload assets, updated $updated"
        }
    }

    override fun insert(asset: FileAsset) {
        val inserted = db
            .insertInto(FILE_ASSETS)
            .set(
                FILE_ASSETS.ID,
                asset.id.value,
            ).set(
                FILE_ASSETS.OWNER_ID,
                asset.ownerId.value,
            ).set(
                FILE_ASSETS.ORIGINAL_FILENAME,
                asset.filename,
            ).set(
                FILE_ASSETS.CONTENT_TYPE,
                asset.contentType,
            ).set(
                FILE_ASSETS.BYTE_SIZE,
                asset.byteSize,
            ).set(
                FILE_ASSETS.HANDLING_MODE,
                FileHandlingMode.valueOf(asset.handlingMode.name),
            ).set(
                FILE_ASSETS.PROCESSING_PROFILE_NAME,
                asset.processingProfileName,
            ).set(
                FILE_ASSETS.PROCESSING_PROFILE_VERSION,
                asset.processingProfileVersion,
            ).set(
                FILE_ASSETS.STATUS,
                FileAssetStatus.valueOf(asset.status.name),
            ).set(
                FILE_ASSETS.BUCKET,
                asset.bucket,
            ).set(
                FILE_ASSETS.PREFIX,
                asset.prefix,
            ).execute()
        check(inserted == 1)
    }

    override fun findById(id: FileAssetId): FileAsset? =
        db
            .selectFrom(FILE_ASSETS)
            .where(FILE_ASSETS.ID.eq(id.value))
            .fetchOne()
            ?.toModel()

    override fun findByIdForUpdate(id: FileAssetId): FileAsset? =
        db
            .selectFrom(FILE_ASSETS)
            .where(FILE_ASSETS.ID.eq(id.value))
            .forUpdate()
            .fetchOne()
            ?.toModel()
}

private fun FileAssetsRecord.toModel() =
    FileAsset(
        id = FileAssetId(id!!),
        ownerId = UserId(ownerId!!),
        filename = originalFilename!!,
        contentType = contentType!!,
        byteSize = byteSize!!,
        handlingMode = HandlingMode.valueOf(handlingMode!!.name),
        processingProfileName = processingProfileName,
        processingProfileVersion = processingProfileVersion,
        status = AssetStatus.valueOf(status!!.name),
        failureCode = failureCode,
        bucket = bucket!!,
        prefix = prefix!!,
    )
