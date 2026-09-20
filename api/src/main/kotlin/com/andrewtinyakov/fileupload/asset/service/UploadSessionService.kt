package com.andrewtinyakov.fileupload.asset.service

import com.andrewtinyakov.fileupload.asset.config.UploadProperties
import com.andrewtinyakov.fileupload.asset.integration.ObjectStorage
import com.andrewtinyakov.fileupload.asset.integration.StorageProperties
import com.andrewtinyakov.fileupload.asset.model.AssetStatus
import com.andrewtinyakov.fileupload.asset.model.FileAsset
import com.andrewtinyakov.fileupload.asset.model.FileAssetId
import com.andrewtinyakov.fileupload.asset.model.HandlingMode
import com.andrewtinyakov.fileupload.asset.model.SessionStatus
import com.andrewtinyakov.fileupload.asset.model.UploadSession
import com.andrewtinyakov.fileupload.asset.model.UploadSessionId
import com.andrewtinyakov.fileupload.asset.model.UploadStrategy
import com.andrewtinyakov.fileupload.asset.model.toResponse
import com.andrewtinyakov.fileupload.asset.monitoring.UploadSessionMetrics
import com.andrewtinyakov.fileupload.asset.repository.FileAssetRepository
import com.andrewtinyakov.fileupload.asset.repository.UploadSessionRepository
import com.andrewtinyakov.fileupload.asset.web.payload.CreateUploadSessionRequest
import com.andrewtinyakov.fileupload.asset.web.payload.UploadSessionResponse
import com.andrewtinyakov.fileupload.shared.crypto.sha256Hex
import com.andrewtinyakov.fileupload.shared.id.UlidGenerator
import com.andrewtinyakov.fileupload.shared.web.ApiErrorCode
import com.andrewtinyakov.fileupload.shared.web.badRequest
import com.andrewtinyakov.fileupload.shared.web.conflict
import com.andrewtinyakov.fileupload.shared.web.notFound
import com.andrewtinyakov.fileupload.user.UserId
import org.springframework.dao.DuplicateKeyException
import org.springframework.http.MediaType
import org.springframework.stereotype.Service
import org.springframework.transaction.support.TransactionTemplate
import tools.jackson.databind.ObjectMapper
import java.time.Clock
import java.time.OffsetDateTime

@Service
class UploadSessionService(
    private val sessionRepository: UploadSessionRepository,
    private val assetRepository: FileAssetRepository,
    private val storage: ObjectStorage,
    private val storageProperties: StorageProperties,
    private val properties: UploadProperties,
    private val ulidGenerator: UlidGenerator,
    private val mapper: ObjectMapper,
    private val tx: TransactionTemplate,
    private val clock: Clock,
    private val metrics: UploadSessionMetrics,
) {
    fun create(
        userId: UserId,
        idempotencyKey: String,
        request: CreateUploadSessionRequest,
    ): UploadSessionResponse {
        validateRequest(
            idempotencyKey = idempotencyKey,
            request = request,
        )
        val fingerprint = sha256Hex(mapper.writeValueAsBytes(request))
        findExistingSession(
            userId = userId,
            idempotencyKey = idempotencyKey,
        )?.let { session ->
            return replaySession(
                session = session,
                fingerprint = fingerprint,
            )
        }

        validateUploadSize(request)

        val asset = createAsset(
            userId = userId,
            assetId = FileAssetId(ulidGenerator.generate()),
            request = request,
        )
        val session = createSession(
            userId = userId,
            assetId = asset.id,
            idempotencyKey = idempotencyKey,
            fingerprint = fingerprint,
            request = request,
            now = OffsetDateTime.now(clock),
        )
        val savedSession = persistUpload(
            asset = asset,
            initialSession = session,
        ).getOrElse { exception ->
            if (exception is DuplicateKeyException) {
                findExistingSession(
                    userId = userId,
                    idempotencyKey = idempotencyKey,
                )?.let { existingSession ->
                    return replaySession(
                        session = existingSession,
                        fingerprint = fingerprint,
                    )
                }
            }
            throw exception
        }
        metrics.sessionCreated(
            handlingMode = asset.handlingMode,
            strategy = savedSession.strategy,
            byteSize = asset.byteSize,
        )
        return savedSession.toResponse(
            asset = asset,
            storage = storage,
            properties = properties,
            clock = clock,
        )
    }

    fun getSession(
        userId: UserId,
        sessionId: UploadSessionId,
    ): UploadSessionResponse {
        val session = sessionRepository.findById(id = sessionId)
            ?.takeIf { it.ownerId == userId }
            ?: notFound()
        return session.toResponse(
            asset = assetRepository.findById(id = session.assetId) ?: notFound(),
            storage = storage,
            properties = properties,
            clock = clock,
        )
    }

    private fun validateRequest(
        idempotencyKey: String,
        request: CreateUploadSessionRequest,
    ) {
        if (idempotencyKey.isBlank() || idempotencyKey.length > 255) {
            badRequest(
                code = ApiErrorCode.INVALID_IDEMPOTENCY_KEY,
                message = "Idempotency-Key must contain 1 to 255 characters",
            )
        }
        runCatching { MediaType.parseMediaType(request.contentType) }.getOrElse { exception ->
            if (exception is IllegalArgumentException) {
                badRequest(
                    code = ApiErrorCode.INVALID_CONTENT_TYPE,
                    message = "contentType must be a MIME type",
                )
            }
            throw exception
        }
    }

    private fun validateUploadSize(request: CreateUploadSessionRequest) {
        val maximum = if (request.handlingMode == HandlingMode.IMAGE) {
            properties.maxImageSize
        } else {
            properties.maxDocumentSize
        }
        if (request.byteSize > maximum) {
            badRequest(
                code = ApiErrorCode.FILE_TOO_LARGE,
                message = "byteSize exceeds the configured limit",
            )
        }
    }

    private fun createAsset(
        userId: UserId,
        assetId: FileAssetId,
        request: CreateUploadSessionRequest,
    ): FileAsset {
        val image = request.handlingMode == HandlingMode.IMAGE
        return FileAsset(
            id = assetId,
            ownerId = userId,
            filename = request.filename,
            contentType = request.contentType,
            byteSize = request.byteSize,
            handlingMode = request.handlingMode,
            processingProfileName = if (image) properties.processingProfileName else null,
            processingProfileVersion = if (image) properties.processingProfileVersion else null,
            status = AssetStatus.AWAITING_UPLOAD,
            failureCode = null,
            bucket = storageProperties.assetsBucket,
            prefix = "assets/${assetId.value}/",
        )
    }

    private fun createSession(
        userId: UserId,
        assetId: FileAssetId,
        idempotencyKey: String,
        fingerprint: String,
        request: CreateUploadSessionRequest,
        now: OffsetDateTime,
    ): UploadSession {
        val strategy = if (request.byteSize >= properties.multipartThreshold) {
            UploadStrategy.MULTIPART
        } else {
            UploadStrategy.SINGLE
        }
        return UploadSession(
            id = UploadSessionId(ulidGenerator.generate()),
            assetId = assetId,
            ownerId = userId,
            idempotencyKey = idempotencyKey,
            requestFingerprint = fingerprint,
            strategy = strategy,
            status = SessionStatus.CREATED,
            bucket = storageProperties.uploadsBucket,
            objectKey = "uploads/${assetId.value}/${ulidGenerator.generate()}",
            providerUploadId = null,
            objectEtag = null,
            expiresAt = now.plus(properties.sessionLifetime),
            partSize = if (strategy == UploadStrategy.MULTIPART) properties.partSize else null,
        )
    }

    private fun persistUpload(
        asset: FileAsset,
        initialSession: UploadSession,
    ): Result<UploadSession> {
        val session = runCatching {
            if (initialSession.strategy == UploadStrategy.MULTIPART) {
                initialSession.copy(
                    providerUploadId = storage.startMultipart(
                        bucket = initialSession.bucket,
                        key = initialSession.objectKey,
                        contentType = asset.contentType,
                    ),
                )
            } else {
                initialSession
            }
        }.getOrElse { exception ->
            cleanupFailedSession(
                session = initialSession,
                failure = exception,
            )
            return Result.failure(exception)
        }
        return runCatching {
            tx.executeWithoutResult {
                assetRepository.insert(asset = asset)
                sessionRepository.insert(session = session)
            }
            session
        }.onFailure { exception ->
            cleanupFailedSession(
                session = session,
                failure = exception,
            )
        }
    }

    private fun findExistingSession(
        userId: UserId,
        idempotencyKey: String,
    ): UploadSession? = sessionRepository.findByOwnerAndIdempotencyKey(
        ownerId = userId,
        key = idempotencyKey,
    )

    private fun replaySession(
        session: UploadSession,
        fingerprint: String,
    ): UploadSessionResponse {
        if (session.requestFingerprint != fingerprint) {
            conflict(
                code = ApiErrorCode.IDEMPOTENCY_CONFLICT,
                message = "Idempotency-Key was already used for a different request",
            )
        }
        return session.toResponse(
            asset = assetRepository.findById(id = session.assetId) ?: notFound(),
            storage = storage,
            properties = properties,
            clock = clock,
        )
    }

    private fun cleanupFailedSession(
        session: UploadSession,
        failure: Throwable,
    ) {
        session.providerUploadId?.let { uploadId ->
            runCatching {
                storage.abortMultipart(
                    bucket = session.bucket,
                    objectKey = session.objectKey,
                    uploadId = uploadId,
                )
            }.onFailure {
                if (it !is Exception) {
                    throw it
                }
                failure.addSuppressed(it)
            }
        }
    }
}
