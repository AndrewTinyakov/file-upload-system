package com.andrewtinyakov.fileupload.asset.web.payload

import com.andrewtinyakov.fileupload.asset.integration.dto.PresignedRequest
import com.andrewtinyakov.fileupload.asset.model.FileAssetId
import com.andrewtinyakov.fileupload.asset.model.HandlingMode
import com.andrewtinyakov.fileupload.asset.model.SessionStatus
import com.andrewtinyakov.fileupload.asset.model.UploadSession
import com.andrewtinyakov.fileupload.asset.model.UploadStrategy
import io.swagger.v3.oas.annotations.media.Schema
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.PositiveOrZero
import jakarta.validation.constraints.Size
import java.time.OffsetDateTime

data class CreateUploadSessionRequest(
    @field:NotBlank
    @field:Size(max = 1024)
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val filename: String,
    @field:NotBlank
    @field:Size(max = 255)
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val contentType: String,
    @field:PositiveOrZero
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val byteSize: Long,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val handlingMode: HandlingMode,
)

data class UploadInstructions(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val url: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val method: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val headers: Map<String, String>,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
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
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val sessionId: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val assetId: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val strategy: UploadStrategy,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val status: SessionStatus,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
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
    sessionId = id.value,
    assetId = assetId.value,
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
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val partNumber: Int,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val etag: String,
)

data class CompleteUploadSessionRequest(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val parts: List<CompletedPart> = emptyList(),
)

data class SignPartsRequest(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val partNumbers: List<Int>,
)

data class SignedPart(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val partNumber: Int,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val upload: UploadInstructions,
)

data class SignedPartsResponse(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val parts: List<SignedPart>,
)
