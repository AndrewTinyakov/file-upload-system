package com.andrewtinyakov.fileupload.asset.model

import com.andrewtinyakov.fileupload.user.UserId

data class FileAsset(
    val id: FileAssetId,
    val ownerId: UserId,
    val filename: String,
    val contentType: String,
    val byteSize: Long,
    val handlingMode: HandlingMode,
    val processingProfileName: String?,
    val processingProfileVersion: Int?,
    val status: AssetStatus,
    val failureCode: String?,
    val bucket: String,
    val prefix: String,
) {
    init {
        require(filename.isNotBlank())
        require(contentType.isNotBlank())
        require(byteSize >= 0)
        require(bucket.isNotBlank())
        require(prefix.isNotBlank() && prefix.endsWith('/'))
        if (handlingMode == HandlingMode.DOCUMENT) {
            require(processingProfileName == null && processingProfileVersion == null)
        } else {
            require(
                !processingProfileName.isNullOrBlank() &&
                    processingProfileVersion != null &&
                    processingProfileVersion > 0,
            )
        }
        if (status == AssetStatus.FAILED || status == AssetStatus.DISCARDED) {
            require(!failureCode.isNullOrBlank())
        } else {
            require(failureCode == null)
        }
    }
}
