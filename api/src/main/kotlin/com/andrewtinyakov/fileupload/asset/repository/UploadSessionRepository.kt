package com.andrewtinyakov.fileupload.asset.repository

import com.andrewtinyakov.fileupload.asset.model.SessionStatus
import com.andrewtinyakov.fileupload.asset.model.UploadSession
import com.andrewtinyakov.fileupload.asset.model.UploadSessionId
import com.andrewtinyakov.fileupload.user.UserId
import java.time.OffsetDateTime

interface UploadSessionRepository {
    fun findExpiredForUpdate(
        now: OffsetDateTime,
        limit: Int,
    ): List<UploadSession>

    fun close(
        id: UploadSessionId,
        status: SessionStatus,
        now: OffsetDateTime,
    )

    fun expire(
        ids: Collection<UploadSessionId>,
        now: OffsetDateTime,
    )

    fun complete(
        id: UploadSessionId,
        etag: String,
        now: OffsetDateTime,
    )

    fun insert(session: UploadSession)

    fun findById(id: UploadSessionId): UploadSession?

    fun findByIdForUpdate(id: UploadSessionId): UploadSession?

    fun findByOwnerAndIdempotencyKey(
        ownerId: UserId,
        key: String,
    ): UploadSession?
}
