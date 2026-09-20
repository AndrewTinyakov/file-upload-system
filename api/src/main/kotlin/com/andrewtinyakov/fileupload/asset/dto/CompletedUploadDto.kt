package com.andrewtinyakov.fileupload.asset.dto

import com.andrewtinyakov.fileupload.asset.model.HandlingMode
import com.andrewtinyakov.fileupload.asset.model.UploadStrategy

internal data class CompletedUploadDto(
    val handlingMode: HandlingMode,
    val strategy: UploadStrategy,
    val byteSize: Long,
)
