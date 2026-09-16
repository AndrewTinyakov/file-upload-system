package com.andrewtinyakov.fileupload.asset.messaging


data class AssetPreparationFailedEventV1(
    val commandId: String,
    val assetId: String,
    val failureCode: String,
)