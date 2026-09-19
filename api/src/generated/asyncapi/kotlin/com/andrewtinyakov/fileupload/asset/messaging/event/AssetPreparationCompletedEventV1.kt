package com.andrewtinyakov.fileupload.asset.messaging.event

@javax.annotation.processing.Generated("contracts/generate-models.mjs")
data class AssetPreparationCompletedEventV1(
    val commandId: String,
    val assetId: String,
    val variants: List<AssetVariantV1>,
)
