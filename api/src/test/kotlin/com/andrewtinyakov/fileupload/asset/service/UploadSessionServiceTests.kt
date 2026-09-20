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
import com.andrewtinyakov.fileupload.asset.monitoring.UploadSessionMetrics
import com.andrewtinyakov.fileupload.asset.repository.FileAssetRepository
import com.andrewtinyakov.fileupload.asset.repository.UploadSessionRepository
import com.andrewtinyakov.fileupload.asset.web.payload.CreateUploadSessionRequest
import com.andrewtinyakov.fileupload.shared.crypto.sha256Hex
import com.andrewtinyakov.fileupload.shared.id.UlidGenerator
import com.andrewtinyakov.fileupload.shared.web.ApiErrorCode
import com.andrewtinyakov.fileupload.shared.web.ApiException
import com.andrewtinyakov.fileupload.user.UserId
import io.micrometer.core.instrument.simple.SimpleMeterRegistry
import org.junit.jupiter.api.Test
import org.mockito.Mockito
import org.springframework.http.HttpStatus
import org.springframework.transaction.support.TransactionTemplate
import tools.jackson.databind.ObjectMapper
import java.time.Clock
import java.time.OffsetDateTime
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class UploadSessionServiceTests {
    private val sessionRepository = Mockito.mock(UploadSessionRepository::class.java)
    private val assetRepository = Mockito.mock(FileAssetRepository::class.java)
    private val storage = Mockito.mock(ObjectStorage::class.java)
    private val mapper = ObjectMapper()
    private val owner = UserId("owner")
    private val request = CreateUploadSessionRequest("document.txt", "text/plain", 5, HandlingMode.DOCUMENT)
    private val session = UploadSession(
        id = UploadSessionId("session"),
        assetId = FileAssetId("asset"),
        ownerId = owner,
        idempotencyKey = "existing-key",
        requestFingerprint = sha256Hex(mapper.writeValueAsBytes(request)),
        strategy = UploadStrategy.SINGLE,
        status = SessionStatus.COMPLETED,
        bucket = "uploads",
        objectKey = "uploads/object",
        providerUploadId = null,
        objectEtag = "etag",
        expiresAt = OffsetDateTime.now().plusHours(1),
    )
    private val service = UploadSessionService(
        sessionRepository = sessionRepository,
        assetRepository = assetRepository,
        storage = storage,
        storageProperties = StorageProperties(),
        properties = UploadProperties(maxDocumentSize = 4),
        ulidGenerator = UlidGenerator(),
        mapper = mapper,
        tx = TransactionTemplate(),
        clock = Clock.systemUTC(),
        metrics = UploadSessionMetrics(SimpleMeterRegistry()),
    )

    @Test
    fun `existing upload session ignores a lower size limit`() {
        Mockito.`when`(sessionRepository.findByOwnerAndIdempotencyKey(owner, session.idempotencyKey)).thenReturn(session)
        Mockito.`when`(assetRepository.findById(session.assetId)).thenReturn(
            FileAsset(
                id = session.assetId,
                ownerId = owner,
                filename = request.filename,
                contentType = request.contentType,
                byteSize = request.byteSize,
                handlingMode = request.handlingMode,
                processingProfileName = null,
                processingProfileVersion = null,
                status = AssetStatus.PREPARING,
                failureCode = null,
                bucket = "assets",
                prefix = "assets/asset/",
            ),
        )

        val response = service.create(owner, session.idempotencyKey, request)

        assertEquals(session.id, response.sessionId)
        assertEquals(session.assetId, response.assetId)
        assertEquals(SessionStatus.COMPLETED, response.status)
        Mockito.verifyNoInteractions(storage)
    }

    @Test
    fun `changed request returns conflict before the size check`() {
        Mockito.`when`(sessionRepository.findByOwnerAndIdempotencyKey(owner, session.idempotencyKey)).thenReturn(session)

        val exception = assertFailsWith<ApiException> {
            service.create(owner, session.idempotencyKey, request.copy(byteSize = 6))
        }

        assertEquals(HttpStatus.CONFLICT, exception.status)
        assertEquals(ApiErrorCode.IDEMPOTENCY_CONFLICT, exception.code)
        Mockito.verifyNoInteractions(assetRepository, storage)
    }

    @Test
    fun `new upload session rejects a file above the size limit`() {
        val exception = assertFailsWith<ApiException> {
            service.create(owner, "new-key", request)
        }

        assertEquals(HttpStatus.BAD_REQUEST, exception.status)
        assertEquals(ApiErrorCode.FILE_TOO_LARGE, exception.code)
        Mockito.verifyNoInteractions(assetRepository, storage)
    }
}
