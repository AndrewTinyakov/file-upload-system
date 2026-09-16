package com.andrewtinyakov.fileupload.asset.messaging


data class PrepareDocumentCommandV1(
    val commandId: String,
    val assetId: String,
    val sourceBucket: String,
    val sourceObjectKey: String,
    val sourceContentType: String,
    val sourceByteSize: Long,
    val sourceObjectEtag: String,
    val destinationBucket: String,
    val destinationPrefix: String,
)