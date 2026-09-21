package com.andrewtinyakov.fileupload.asset.web.controller

import com.andrewtinyakov.fileupload.asset.model.FileAssetId
import com.andrewtinyakov.fileupload.asset.service.FileAssetService
import com.andrewtinyakov.fileupload.asset.web.payload.FileAssetResponse
import com.andrewtinyakov.fileupload.user.validateUserId
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RequestHeader
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

@RestController
@RequestMapping("/v1/assets")
class FileAssetController(
    private val fileAssetService: FileAssetService,
) {
    @GetMapping("/{assetId}")
    fun getAsset(
        @RequestHeader("X-User-ID") userId: String,
        @PathVariable assetId: String,
    ): FileAssetResponse = fileAssetService.getAsset(
        userId = validateUserId(userId),
        assetId = FileAssetId(assetId),
    )
}
