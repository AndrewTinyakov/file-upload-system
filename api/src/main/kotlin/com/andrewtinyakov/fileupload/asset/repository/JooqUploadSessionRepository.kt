package com.andrewtinyakov.fileupload.asset.repository

import com.andrewtinyakov.fileupload.asset.model.FileAssetId
import com.andrewtinyakov.fileupload.asset.model.SessionStatus
import com.andrewtinyakov.fileupload.asset.model.UploadSession
import com.andrewtinyakov.fileupload.asset.model.UploadSessionId
import com.andrewtinyakov.fileupload.asset.model.UploadStrategy
import com.andrewtinyakov.fileupload.infrastructure.database.generated.enums.UploadSessionStatus
import com.andrewtinyakov.fileupload.infrastructure.database.generated.tables.UploadSessions.UPLOAD_SESSIONS
import com.andrewtinyakov.fileupload.infrastructure.database.generated.tables.records.UploadSessionsRecord
import com.andrewtinyakov.fileupload.user.UserId
import org.jooq.DSLContext
import org.springframework.stereotype.Repository
import java.time.OffsetDateTime
import com.andrewtinyakov.fileupload.infrastructure.database.generated.enums.UploadStrategy as DatabaseUploadStrategy

@Repository
class JooqUploadSessionRepository(
    private val db: DSLContext,
) : UploadSessionRepository {
    override fun findExpiredForUpdate(
        now: OffsetDateTime,
        limit: Int,
    ): List<UploadSession> =
        db
            .selectFrom(UPLOAD_SESSIONS)
            .where(
                UPLOAD_SESSIONS.STATUS.eq(UploadSessionStatus.CREATED),
                UPLOAD_SESSIONS.EXPIRES_AT.le(now),
            ).orderBy(UPLOAD_SESSIONS.EXPIRES_AT)
            .limit(limit)
            .forUpdate()
            .skipLocked()
            .fetch()
            .map { it.toModel() }

    override fun close(
        id: UploadSessionId,
        status: SessionStatus,
        now: OffsetDateTime,
    ) {
        require(status == SessionStatus.ABORTED || status == SessionStatus.EXPIRED)
        val updated = db
            .update(UPLOAD_SESSIONS)
            .set(
                UPLOAD_SESSIONS.STATUS,
                UploadSessionStatus.valueOf(status.name),
            ).set(
                UPLOAD_SESSIONS.UPDATED_AT,
                now,
            ).where(
                UPLOAD_SESSIONS.ID.eq(id.value),
                UPLOAD_SESSIONS.STATUS.eq(UploadSessionStatus.CREATED),
            ).execute()
        check(updated == 1)
    }

    override fun expire(
        ids: Collection<UploadSessionId>,
        now: OffsetDateTime,
    ) {
        if (ids.isEmpty()) {
            return
        }
        val updated = db
            .update(UPLOAD_SESSIONS)
            .set(
                UPLOAD_SESSIONS.STATUS,
                UploadSessionStatus.EXPIRED,
            ).set(
                UPLOAD_SESSIONS.UPDATED_AT,
                now,
            ).where(
                UPLOAD_SESSIONS.ID.`in`(ids.map(UploadSessionId::value)),
                UPLOAD_SESSIONS.STATUS.eq(UploadSessionStatus.CREATED),
            ).execute()
        check(updated == ids.size) {
            "Expected to expire ${ids.size} upload sessions, updated $updated"
        }
    }

    override fun complete(
        id: UploadSessionId,
        etag: String,
        now: OffsetDateTime,
    ) {
        val updated = db
            .update(UPLOAD_SESSIONS)
            .set(
                UPLOAD_SESSIONS.STATUS,
                UploadSessionStatus.COMPLETED,
            ).set(
                UPLOAD_SESSIONS.OBJECT_ETAG,
                etag,
            ).set(
                UPLOAD_SESSIONS.COMPLETED_AT,
                now,
            ).set(
                UPLOAD_SESSIONS.UPDATED_AT,
                now,
            ).where(
                UPLOAD_SESSIONS.ID.eq(id.value),
                UPLOAD_SESSIONS.STATUS.eq(UploadSessionStatus.CREATED),
            ).execute()
        check(updated == 1)
    }

    override fun insert(session: UploadSession) {
        val inserted = db
            .insertInto(UPLOAD_SESSIONS)
            .set(
                UPLOAD_SESSIONS.ID,
                session.id.value,
            ).set(
                UPLOAD_SESSIONS.FILE_ASSET_ID,
                session.assetId.value,
            ).set(
                UPLOAD_SESSIONS.OWNER_ID,
                session.ownerId.value,
            ).set(
                UPLOAD_SESSIONS.IDEMPOTENCY_KEY,
                session.idempotencyKey,
            ).set(
                UPLOAD_SESSIONS.REQUEST_FINGERPRINT,
                session.requestFingerprint,
            ).set(
                UPLOAD_SESSIONS.STRATEGY,
                DatabaseUploadStrategy.valueOf(session.strategy.name),
            ).set(
                UPLOAD_SESSIONS.UPLOADED_OBJECT_BUCKET,
                session.bucket,
            ).set(
                UPLOAD_SESSIONS.UPLOADED_OBJECT_KEY,
                session.objectKey,
            ).set(
                UPLOAD_SESSIONS.PART_SIZE,
                session.partSize,
            ).set(
                UPLOAD_SESSIONS.PROVIDER_UPLOAD_ID,
                session.providerUploadId,
            ).set(
                UPLOAD_SESSIONS.EXPIRES_AT,
                session.expiresAt,
            ).execute()
        check(inserted == 1)
    }

    override fun findById(id: UploadSessionId): UploadSession? =
        db
            .selectFrom(UPLOAD_SESSIONS)
            .where(UPLOAD_SESSIONS.ID.eq(id.value))
            .fetchOne()
            ?.toModel()

    override fun findByIdForUpdate(id: UploadSessionId): UploadSession? =
        db
            .selectFrom(UPLOAD_SESSIONS)
            .where(UPLOAD_SESSIONS.ID.eq(id.value))
            .forUpdate()
            .fetchOne()
            ?.toModel()

    override fun findByOwnerAndIdempotencyKey(
        ownerId: UserId,
        key: String,
    ): UploadSession? =
        db
            .selectFrom(UPLOAD_SESSIONS)
            .where(
                UPLOAD_SESSIONS.OWNER_ID.eq(ownerId.value),
                UPLOAD_SESSIONS.IDEMPOTENCY_KEY.eq(key),
            ).fetchOne()
            ?.toModel()
}

private fun UploadSessionsRecord.toModel() =
    UploadSession(
        id = UploadSessionId(id!!),
        assetId = FileAssetId(fileAssetId!!),
        ownerId = UserId(ownerId!!),
        idempotencyKey = idempotencyKey!!,
        requestFingerprint = requestFingerprint!!,
        strategy = UploadStrategy.valueOf(strategy!!.name),
        status = SessionStatus.valueOf(status!!.name),
        bucket = uploadedObjectBucket!!,
        objectKey = uploadedObjectKey!!,
        providerUploadId = providerUploadId,
        objectEtag = objectEtag,
        expiresAt = expiresAt!!,
        partSize = partSize,
    )
