package com.andrewtinyakov.fileupload.asset.web.payload

import com.andrewtinyakov.fileupload.asset.model.AssetStatus
import com.andrewtinyakov.fileupload.asset.model.AssetVariant
import com.andrewtinyakov.fileupload.asset.model.FileAsset
import com.andrewtinyakov.fileupload.asset.model.HandlingMode
import com.andrewtinyakov.fileupload.asset.model.VariantType
import io.swagger.v3.oas.annotations.media.Schema

data class FileAssetResponse(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val assetId: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val filename: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val contentType: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val byteSize: Long,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val handlingMode: HandlingMode,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val status: AssetStatus,
    val failureCode: String?,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val variants: List<AssetVariantResponse> = emptyList(),
)

data class AssetVariantResponse(
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val variantType: VariantType,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val url: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
    val contentType: String,
    @field:Schema(requiredMode = Schema.RequiredMode.REQUIRED)
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
    assetId = id.value,
    filename = filename,
    contentType = contentType,
    byteSize = byteSize,
    handlingMode = handlingMode,
    status = status,
    failureCode = failureCode,
    variants = variants.map { it.toResponse(url = variantUrl(it)) },
)
