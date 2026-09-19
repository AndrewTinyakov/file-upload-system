package com.andrewtinyakov.fileupload.asset.integration

import com.andrewtinyakov.fileupload.asset.integration.dto.MultipartPart
import com.andrewtinyakov.fileupload.asset.integration.dto.PresignedRequest
import com.andrewtinyakov.fileupload.asset.integration.dto.StoredObjectMetadata
import java.time.Duration

interface ObjectStorage {
    fun getPublicUrl(
        bucket: String,
        objectKey: String,
    ): String

    fun deleteByPrefix(
        bucket: String,
        prefix: String,
    )

    fun presignPart(
        bucket: String,
        objectKey: String,
        uploadId: String,
        partNumber: Int,
        lifetime: Duration,
    ): PresignedRequest

    fun completeMultipartUpload(
        bucket: String,
        objectKey: String,
        uploadId: String,
        parts: List<MultipartPart>,
    )

    fun getMetadata(
        bucket: String,
        objectKey: String,
    ): StoredObjectMetadata

    fun startMultipart(
        bucket: String,
        key: String,
        contentType: String,
    ): String

    fun abortMultipart(
        bucket: String,
        objectKey: String,
        uploadId: String,
    )

    fun presignPut(
        bucket: String,
        objectKey: String,
        contentType: String,
        byteSize: Long,
        lifetime: Duration,
    ): PresignedRequest
}
