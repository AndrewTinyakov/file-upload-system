package com.andrewtinyakov.fileupload.asset.messaging.event

@javax.annotation.processing.Generated("contracts/generate-models.mjs")
data class AssetVariantV1(
    val variantType: AssetVariantType,
    val bucket: String,
    val objectKey: String,
    val contentType: String,
    val byteSize: Long,
    val pixelDimensions: PixelDimensionsV1? = null,
)
