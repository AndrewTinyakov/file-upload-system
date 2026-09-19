package com.andrewtinyakov.fileupload.asset.repository

import com.andrewtinyakov.fileupload.asset.model.AssetVariant
import com.andrewtinyakov.fileupload.asset.model.FileAssetId

interface AssetVariantRepository {
    fun findByAssetId(assetId: FileAssetId): List<AssetVariant>

    fun insert(
        assetId: FileAssetId,
        variants: List<AssetVariant>,
    )
}
