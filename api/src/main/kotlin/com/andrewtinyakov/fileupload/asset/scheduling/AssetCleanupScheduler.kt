package com.andrewtinyakov.fileupload.asset.scheduling

import com.andrewtinyakov.fileupload.asset.service.AssetCleanupService
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component

@Component
class AssetCleanupScheduler(
    private val assetCleanupService: AssetCleanupService,
) {
    @Scheduled(fixedDelayString = $$"${file-upload.scheduling.cleanup-delay:60000}")
    fun runCleanup(): Int = assetCleanupService.requestFailedAssetCleanup()
}
