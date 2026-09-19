package com.andrewtinyakov.fileupload.asset.messaging.event

@javax.annotation.processing.Generated("contracts/generate-models.mjs")
data class AssetPreparationFailedEventV1(
    val commandId: String,
    val assetId: String,
    val failureCode: String,
)
