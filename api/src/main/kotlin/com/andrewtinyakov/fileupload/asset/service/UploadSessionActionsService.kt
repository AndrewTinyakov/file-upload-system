package com.andrewtinyakov.fileupload.asset.service

import com.andrewtinyakov.fileupload.asset.config.UploadProperties
import com.andrewtinyakov.fileupload.asset.integration.ObjectStorage
import com.andrewtinyakov.fileupload.asset.integration.dto.MultipartPart
import com.andrewtinyakov.fileupload.asset.messaging.publisher.AssetPreparationPublisher
import com.andrewtinyakov.fileupload.asset.model.AssetStatus
import com.andrewtinyakov.fileupload.asset.model.FileAsset
import com.andrewtinyakov.fileupload.asset.model.SessionStatus
import com.andrewtinyakov.fileupload.asset.model.UploadSession
import com.andrewtinyakov.fileupload.asset.model.UploadSessionId
import com.andrewtinyakov.fileupload.asset.model.UploadStrategy
import com.andrewtinyakov.fileupload.asset.model.toResponse
import com.andrewtinyakov.fileupload.asset.repository.FileAssetRepository
import com.andrewtinyakov.fileupload.asset.repository.UploadSessionRepository
import com.andrewtinyakov.fileupload.asset.web.payload.CompleteUploadSessionRequest
import com.andrewtinyakov.fileupload.asset.web.payload.FileAssetResponse
import com.andrewtinyakov.fileupload.asset.web.payload.SignPartsRequest
import com.andrewtinyakov.fileupload.asset.web.payload.SignedPart
import com.andrewtinyakov.fileupload.asset.web.payload.SignedPartsResponse
import com.andrewtinyakov.fileupload.asset.web.payload.UploadSessionResponse
import com.andrewtinyakov.fileupload.asset.web.payload.toUploadInstructions
import com.andrewtinyakov.fileupload.shared.web.ApiErrorCode
import com.andrewtinyakov.fileupload.shared.web.badRequest
import com.andrewtinyakov.fileupload.shared.web.conflict
import com.andrewtinyakov.fileupload.shared.web.notFound
import com.andrewtinyakov.fileupload.user.UserId
import org.springframework.stereotype.Service
import org.springframework.transaction.support.TransactionTemplate
import java.time.Clock
import java.time.Duration
import java.time.OffsetDateTime

@Service
class UploadSessionActionsService(
    private val sessions: UploadSessionRepository,
    private val assets: FileAssetRepository,
    private val storage: ObjectStorage,
    private val properties: UploadProperties,
    private val transactions: TransactionTemplate,
    private val clock: Clock,
    private val preparation: AssetPreparationPublisher,
    private val fileAssetService: FileAssetService,
) {
    fun abort(
        userId: UserId,
        sessionId: UploadSessionId,
    ): UploadSessionResponse = transactions.execute {
        val session = requireSession(
            userId = userId,
            sessionId = sessionId,
        )
        val asset = assets.findByIdForUpdate(id = session.assetId) ?: notFound()
        if (session.status == SessionStatus.COMPLETED) {
            conflict(
                code = ApiErrorCode.SESSION_COMPLETED,
                message = "A completed upload cannot be aborted",
            )
        }
        if (session.status != SessionStatus.CREATED) {
            return@execute session.toResponse(
                asset = asset,
                storage = storage,
                properties = properties,
                clock = clock,
            )
        }
        session.providerUploadId?.let { uploadId ->
            storage.abortMultipart(
                bucket = session.bucket,
                objectKey = session.objectKey,
                uploadId = uploadId,
            )
        }
        val now = OffsetDateTime.now(clock)
        sessions.close(
            id = session.id,
            status = SessionStatus.ABORTED,
            now = now,
        )
        assets.transitionStatus(
            id = asset.id,
            expected = AssetStatus.AWAITING_UPLOAD,
            next = AssetStatus.FAILED,
            now = now,
            failureCode = "UPLOAD_ABORTED",
        )
        session.copy(status = SessionStatus.ABORTED).toResponse(
            asset = asset,
            storage = storage,
            properties = properties,
            clock = clock,
        )
    }

    fun presignParts(
        userId: UserId,
        sessionId: UploadSessionId,
        request: SignPartsRequest,
    ): SignedPartsResponse = transactions.execute {
        val session = requireSession(
            userId = userId,
            sessionId = sessionId,
        )
        val now = OffsetDateTime.now(clock)
        validateMultipartSession(
            session = session,
            now = now,
        )
        val asset = assets.findById(id = session.assetId) ?: notFound()
        val count = calculateMultipartPartCount(
            session = session,
            asset = asset,
        )
        validatePartNumbers(
            request = request,
            count = count,
        )
        val lifetime = minOf(
            properties.signedUrlLifetime,
            Duration.between(now, session.expiresAt),
        )
        SignedPartsResponse(
            parts = request.partNumbers.map { partNumber ->
                SignedPart(
                    partNumber = partNumber,
                    upload = storage.presignPart(
                        bucket = session.bucket,
                        objectKey = session.objectKey,
                        uploadId = requireNotNull(session.providerUploadId),
                        partNumber = partNumber,
                        lifetime = lifetime,
                    ).toUploadInstructions(expiresAt = now.plus(lifetime)),
                )
            },
        )
    }

    fun complete(
        userId: UserId,
        sessionId: UploadSessionId,
        request: CompleteUploadSessionRequest,
    ): FileAssetResponse = transactions.execute {
        val session = requireSession(
            userId = userId,
            sessionId = sessionId,
        )
        if (session.status == SessionStatus.COMPLETED) {
            return@execute fileAssetService.getAsset(
                userId = userId,
                assetId = session.assetId,
            )
        }
        val now = OffsetDateTime.now(clock)
        validateSession(
            session = session,
            now = now,
        )
        val asset = assets.findByIdForUpdate(id = session.assetId) ?: notFound()
        completeUpload(
            session = session,
            asset = asset,
            request = request,
        )
        val etag = getUploadedEtag(
            session = session,
            asset = asset,
        )
        sessions.complete(
            id = session.id,
            etag = etag,
            now = now,
        )
        assets.transitionStatus(
            id = asset.id,
            expected = AssetStatus.AWAITING_UPLOAD,
            next = AssetStatus.PREPARING,
            now = now,
        )
        preparation.enqueuePreparation(
            asset = asset,
            session = session,
            etag = etag,
        )
        fileAssetService.getAsset(
            userId = userId,
            assetId = asset.id,
        )
    }

    private fun requireSession(
        userId: UserId,
        sessionId: UploadSessionId,
    ): UploadSession = sessions.findByIdForUpdate(id = sessionId)
        ?.takeIf { it.ownerId == userId }
        ?: notFound()

    private fun validateMultipartSession(
        session: UploadSession,
        now: OffsetDateTime,
    ) {
        validateSession(
            session = session,
            now = now,
        )
        if (session.strategy != UploadStrategy.MULTIPART) {
            badRequest(
                code = ApiErrorCode.NOT_MULTIPART,
                message = "This session uses a single upload",
            )
        }
    }

    private fun validatePartNumbers(
        request: SignPartsRequest,
        count: Int,
    ) {
        val parts = request.partNumbers
        if (parts.isEmpty() || parts.size > properties.maxPartsPerRequest || parts.distinct().size != parts.size ||
            parts.any { it !in 1..count }
        ) {
            badRequest(
                code = ApiErrorCode.INVALID_PARTS,
                message = "Request distinct part numbers within the session's part count and configured batch limit",
            )
        }
    }

    private fun validateSession(
        session: UploadSession,
        now: OffsetDateTime,
    ) {
        if (session.status != SessionStatus.CREATED) {
            conflict(
                code = ApiErrorCode.SESSION_CLOSED,
                message = "The upload session is closed",
            )
        }
        if (!session.expiresAt.isAfter(now)) {
            conflict(
                code = ApiErrorCode.SESSION_EXPIRED,
                message = "The upload session has expired",
            )
        }
    }

    private fun completeUpload(
        session: UploadSession,
        asset: FileAsset,
        request: CompleteUploadSessionRequest,
    ) {
        if (session.strategy != UploadStrategy.MULTIPART) {
            if (request.parts.isNotEmpty()) {
                badRequest(
                    code = ApiErrorCode.INVALID_PARTS,
                    message = "Single uploads do not accept parts",
                )
            }
            return
        }
        val count = calculateMultipartPartCount(
            session = session,
            asset = asset,
        )
        if (request.parts.size != count || request.parts.map { it.partNumber } != (1..count).toList() ||
            request.parts.any { it.etag.isBlank() || it.etag.length > 1024 }
        ) {
            badRequest(
                code = ApiErrorCode.INVALID_PARTS,
                message = "Supply every part in ascending order with its ETag",
            )
        }
        storage.completeMultipartUpload(
            bucket = session.bucket,
            objectKey = session.objectKey,
            uploadId = requireNotNull(session.providerUploadId),
            parts = request.parts.map {
                MultipartPart(
                    partNumber = it.partNumber,
                    etag = it.etag,
                )
            },
        )
    }

    private fun getUploadedEtag(
        session: UploadSession,
        asset: FileAsset,
    ): String {
        val uploaded = storage.getMetadata(
            bucket = session.bucket,
            objectKey = session.objectKey,
        )
        if (uploaded.byteSize != asset.byteSize) {
            conflict(
                code = ApiErrorCode.UPLOAD_SIZE_MISMATCH,
                message = "Uploaded object size differs from byteSize",
            )
        }
        return uploaded.etag
            ?.takeIf { it.isNotBlank() }
            ?: conflict(
                code = ApiErrorCode.UPLOAD_ETAG_MISSING,
                message = "Uploaded object has no ETag",
            )
    }

    private fun calculateMultipartPartCount(
        session: UploadSession,
        asset: FileAsset,
    ): Int {
        val partSize = session.partSize
        return ((asset.byteSize - 1) / requireNotNull(partSize) + 1).toInt()
    }
}
