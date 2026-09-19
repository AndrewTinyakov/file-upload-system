package com.andrewtinyakov.fileupload.asset.messaging.command

@javax.annotation.processing.Generated("contracts/generate-models.mjs")
data class DeleteAssetPrefixCommandV1(
    val commandId: String,
    val assetId: String,
    val bucket: String,
    val prefix: String,
)
