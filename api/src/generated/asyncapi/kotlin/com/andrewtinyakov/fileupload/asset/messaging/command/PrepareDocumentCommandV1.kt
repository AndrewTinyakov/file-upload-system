package com.andrewtinyakov.fileupload.asset.messaging.command

@javax.annotation.processing.Generated("contracts/generate-models.mjs")
data class PrepareDocumentCommandV1(
    val commandId: String,
    val assetId: String,
    val preparationStartedAt: java.time.OffsetDateTime,
    val sourceBucket: String,
    val sourceObjectKey: String,
    val sourceContentType: String,
    val sourceByteSize: Long,
    val sourceObjectEtag: String,
    val destinationBucket: String,
    val destinationPrefix: String,
)
