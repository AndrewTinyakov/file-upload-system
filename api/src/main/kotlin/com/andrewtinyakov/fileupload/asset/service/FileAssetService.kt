package com.andrewtinyakov.fileupload.asset.service

import com.andrewtinyakov.fileupload.asset.integration.ObjectStorage
import com.andrewtinyakov.fileupload.asset.model.AssetStatus
import com.andrewtinyakov.fileupload.asset.model.FileAssetId
import com.andrewtinyakov.fileupload.asset.repository.AssetVariantRepository
import com.andrewtinyakov.fileupload.asset.repository.FileAssetRepository
import com.andrewtinyakov.fileupload.asset.web.payload.FileAssetResponse
import com.andrewtinyakov.fileupload.asset.web.payload.toResponse
import com.andrewtinyakov.fileupload.shared.web.notFound
import com.andrewtinyakov.fileupload.user.UserId
import org.springframework.stereotype.Service

@Service
class FileAssetService(
    private val assetRepository: FileAssetRepository,
    private val variantRepository: AssetVariantRepository,
    private val storage: ObjectStorage,
) {
    fun getAsset(
        userId: UserId,
        assetId: FileAssetId,
    ): FileAssetResponse {
        val asset = assetRepository.findById(id = assetId)
            ?.takeIf { it.ownerId == userId }
            ?: notFound()
        val responseVariants = if (asset.status == AssetStatus.READY) {
            variantRepository.findByAssetId(assetId = asset.id)
        } else {
            emptyList()
        }
        return asset.toResponse(
            variants = responseVariants,
            variantUrl = { variant ->
                storage.getPublicUrl(
                    bucket = variant.bucket,
                    objectKey = variant.objectKey,
                )
            },
        )
    }
}
