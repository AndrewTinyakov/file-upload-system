package com.andrewtinyakov.fileupload.asset.web.payload

import com.andrewtinyakov.fileupload.asset.integration.dto.PresignedRequest
import com.andrewtinyakov.fileupload.asset.model.FileAssetId
import com.andrewtinyakov.fileupload.asset.model.HandlingMode
import com.andrewtinyakov.fileupload.asset.model.SessionStatus
import com.andrewtinyakov.fileupload.asset.model.UploadSession
import com.andrewtinyakov.fileupload.asset.model.UploadSessionId
import com.andrewtinyakov.fileupload.asset.model.UploadStrategy
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.PositiveOrZero
import jakarta.validation.constraints.Size
import java.time.OffsetDateTime

data class CreateUploadSessionRequest(
    @field:NotBlank @field:Size(max = 1024) val filename: String,
    @field:NotBlank @field:Size(max = 255) val contentType: String,
    @field:PositiveOrZero val byteSize: Long,
    val handlingMode: HandlingMode,
)

data class UploadInstructions(
    val url: String,
    val method: String,
    val headers: Map<String, String>,
    val expiresAt: OffsetDateTime,
)

fun PresignedRequest.toUploadInstructions(expiresAt: OffsetDateTime) =
    UploadInstructions(
        url = url,
        method = method,
        headers = headers,
        expiresAt = expiresAt,
    )

data class UploadSessionResponse(
    val sessionId: UploadSessionId,
    val assetId: FileAssetId,
    val strategy: UploadStrategy,
    val status: SessionStatus,
    val expiresAt: OffsetDateTime,
    val upload: UploadInstructions? = null,
    val partSize: Long? = null,
    val partCount: Int? = null,
)

fun UploadSession.toResponse(
    assetId: FileAssetId,
    upload: UploadInstructions?,
    partCount: Int?,
) = UploadSessionResponse(
    sessionId = id,
    assetId = assetId,
    strategy = strategy,
    status = status,
    expiresAt = expiresAt,
    upload = upload,
    partSize = if (strategy == UploadStrategy.MULTIPART) {
        partSize
    } else {
        null
    },
    partCount = partCount,
)

data class CompletedPart(
    val partNumber: Int,
    val etag: String,
)

data class CompleteUploadSessionRequest(
    val parts: List<CompletedPart> = emptyList(),
)

data class SignPartsRequest(
    val partNumbers: List<Int>,
)

data class SignedPart(
    val partNumber: Int,
    val upload: UploadInstructions,
)

data class SignedPartsResponse(
    val parts: List<SignedPart>,
)
