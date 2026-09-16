package com.andrewtinyakov.fileupload.asset.messaging


data class AssetPreparationCompletedEventV1(
    val commandId: String,
    val assetId: String,
    val variants: List<AssetVariantV1>,
)