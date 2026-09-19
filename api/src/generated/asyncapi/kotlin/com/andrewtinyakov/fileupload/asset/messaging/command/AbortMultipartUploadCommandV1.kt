package com.andrewtinyakov.fileupload.asset.messaging.command

@javax.annotation.processing.Generated("contracts/generate-models.mjs")
data class AbortMultipartUploadCommandV1(
    val commandId: String,
    val uploadSessionId: String,
    val bucket: String,
    val objectKey: String,
    val uploadId: String,
)
