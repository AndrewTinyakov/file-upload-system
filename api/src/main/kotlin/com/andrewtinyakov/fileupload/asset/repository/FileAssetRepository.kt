package com.andrewtinyakov.fileupload.asset.repository

import com.andrewtinyakov.fileupload.asset.model.AssetStatus
import com.andrewtinyakov.fileupload.asset.model.FileAsset
import com.andrewtinyakov.fileupload.asset.model.FileAssetId
import java.time.OffsetDateTime

interface FileAssetRepository {
    fun findCleanupCandidatesForUpdate(
        cutoff: OffsetDateTime,
        limit: Int,
    ): List<FileAsset>

    fun requestCleanup(
        ids: Collection<FileAssetId>,
        now: OffsetDateTime,
    )

    fun transitionStatus(
        id: FileAssetId,
        expected: AssetStatus,
        next: AssetStatus,
        now: OffsetDateTime,
        failureCode: String? = null,
    )

    fun failForExpiredUploads(
        ids: Collection<FileAssetId>,
        now: OffsetDateTime,
    )

    fun insert(asset: FileAsset)

    fun findById(id: FileAssetId): FileAsset?

    fun findByIdForUpdate(id: FileAssetId): FileAsset?
}
