package com.andrewtinyakov.fileupload.asset.model

import com.andrewtinyakov.fileupload.asset.messaging.event.AssetPreparationCompletedEventV1
import com.andrewtinyakov.fileupload.asset.messaging.event.AssetVariantV1

data class AssetVariant(
    val type: VariantType,
    val bucket: String,
    val objectKey: String,
    val contentType: String,
    val byteSize: Long,
    val width: Int?,
    val height: Int?,
) {
    init {
        require(
            objectKey.split('/').none { it == "." || it == ".." } &&
                !objectKey.contains('\\'),
        ) {
            "Invalid object key"
        }
        require(byteSize >= 0 && contentType.isNotBlank()) {
            "Invalid variant metadata"
        }
        require(
            (width == null && height == null) ||
                (width != null && width > 0 && height != null && height > 0),
        ) {
            "Invalid variant dimensions"
        }
    }
}

fun AssetVariantV1.toModel() =
    AssetVariant(
        type = VariantType.valueOf(variantType.name),
        bucket = bucket,
        objectKey = objectKey,
        contentType = contentType,
        byteSize = byteSize,
        width = pixelDimensions?.width,
        height = pixelDimensions?.height,
    )

fun AssetPreparationCompletedEventV1.toModels(asset: FileAsset): List<AssetVariant> {
    val prepared = variants.map { it.toModel() }
    val expected = if (asset.handlingMode == HandlingMode.DOCUMENT) {
        setOf(VariantType.ORIGINAL)
    } else {
        setOf(
            VariantType.DISPLAY_SMALL,
            VariantType.DISPLAY_MEDIUM,
            VariantType.DISPLAY_LARGE,
            VariantType.DOWNLOAD,
        )
    }
    require(
        prepared.size == expected.size && prepared.map { it.type }.toSet() == expected,
    ) {
        "Unexpected variant set"
    }
    prepared.forEach { variant ->
        require(
            variant.bucket == asset.bucket && variant.objectKey.startsWith(asset.prefix) &&
                variant.objectKey != asset.prefix &&
                variant.objectKey != asset.prefix + "complete.json",
        ) {
            "Variant is outside its assigned location"
        }
        if (asset.handlingMode == HandlingMode.DOCUMENT) {
            require(
                variant.byteSize == asset.byteSize &&
                    variant.contentType == asset.contentType &&
                    variant.width == null &&
                    variant.height == null,
            ) {
                "Document must be preserved unchanged"
            }
        } else {
            require(
                variant.byteSize > 0,
            ) {
                "Image variant requires positive size"
            }
            if (variant.type == VariantType.DOWNLOAD) {
                require(variant.contentType in setOf("image/jpeg", "image/png")) {
                    "Invalid download format"
                }
            } else {
                require(variant.contentType == "image/webp") {
                    "Invalid display format"
                }
            }
        }
    }
    prepared.groupBy { it.objectKey }.values.forEach { shared ->
        require(
            shared.map { it.copy(type = VariantType.ORIGINAL) }.distinct().size == 1,
        ) {
            "Conflicting metadata for a shared object"
        }
    }
    return prepared
}
