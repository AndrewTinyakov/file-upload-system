package com.andrewtinyakov.fileupload.asset.web.payload

import com.andrewtinyakov.fileupload.asset.model.AssetStatus
import com.andrewtinyakov.fileupload.asset.model.AssetVariant
import com.andrewtinyakov.fileupload.asset.model.FileAsset
import com.andrewtinyakov.fileupload.asset.model.FileAssetId
import com.andrewtinyakov.fileupload.asset.model.HandlingMode
import com.andrewtinyakov.fileupload.asset.model.VariantType

data class FileAssetResponse(
    val assetId: FileAssetId,
    val filename: String,
    val contentType: String,
    val byteSize: Long,
    val handlingMode: HandlingMode,
    val status: AssetStatus,
    val failureCode: String?,
    val variants: List<AssetVariantResponse> = emptyList(),
)

data class AssetVariantResponse(
    val variantType: VariantType,
    val url: String,
    val contentType: String,
    val byteSize: Long,
    val width: Int?,
    val height: Int?,
)

fun AssetVariant.toResponse(url: String) =
    AssetVariantResponse(
        variantType = type,
        url = url,
        contentType = contentType,
        byteSize = byteSize,
        width = width,
        height = height,
    )

fun FileAsset.toResponse(
    variants: List<AssetVariant>,
    variantUrl: (AssetVariant) -> String,
) = FileAssetResponse(
    assetId = id,
    filename = filename,
    contentType = contentType,
    byteSize = byteSize,
    handlingMode = handlingMode,
    status = status,
    failureCode = failureCode,
    variants = variants.map { it.toResponse(url = variantUrl(it)) },
)
