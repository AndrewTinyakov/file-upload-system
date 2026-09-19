package com.andrewtinyakov.fileupload.asset.model

import com.andrewtinyakov.fileupload.asset.config.UploadProperties
import com.andrewtinyakov.fileupload.asset.integration.ObjectStorage
import com.andrewtinyakov.fileupload.asset.web.payload.UploadSessionResponse
import com.andrewtinyakov.fileupload.asset.web.payload.toUploadInstructions
import com.andrewtinyakov.fileupload.user.UserId
import java.time.Clock
import java.time.Duration
import java.time.OffsetDateTime
import com.andrewtinyakov.fileupload.asset.web.payload.toResponse as toPayloadResponse

data class UploadSession(
    val id: UploadSessionId,
    val assetId: FileAssetId,
    val ownerId: UserId,
    val idempotencyKey: String,
    val requestFingerprint: String,
    val strategy: UploadStrategy,
    val status: SessionStatus,
    val bucket: String,
    val objectKey: String,
    val providerUploadId: String?,
    val objectEtag: String?,
    val expiresAt: OffsetDateTime,
    val partSize: Long? = null,
)

fun UploadSession.toResponse(
    asset: FileAsset,
    storage: ObjectStorage,
    properties: UploadProperties,
    clock: Clock,
): UploadSessionResponse {
    val now = OffsetDateTime.now(clock)
    val active = status == SessionStatus.CREATED && expiresAt.isAfter(now)
    val upload = if (active && strategy == UploadStrategy.SINGLE) {
        val lifetime = minOf(
            properties.signedUrlLifetime,
            Duration.between(now, expiresAt),
        )
        storage.presignPut(
            bucket = bucket,
            objectKey = objectKey,
            contentType = asset.contentType,
            byteSize = asset.byteSize,
            lifetime = lifetime,
        ).toUploadInstructions(expiresAt = now.plus(lifetime))
    } else {
        null
    }
    return toPayloadResponse(
        assetId = asset.id,
        upload = upload,
        partCount = if (strategy == UploadStrategy.MULTIPART) {
            calculateMultipartPartCount(asset = asset)
        } else {
            null
        },
    )
}

private fun UploadSession.calculateMultipartPartCount(asset: FileAsset): Int {
    val partSize = requireNotNull(partSize)
    return ((asset.byteSize - 1) / partSize + 1).toInt()
}
