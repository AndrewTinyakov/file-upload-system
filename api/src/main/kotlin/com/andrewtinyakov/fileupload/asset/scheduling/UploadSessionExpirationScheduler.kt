package com.andrewtinyakov.fileupload.asset.scheduling

import com.andrewtinyakov.fileupload.asset.service.UploadSessionExpirationService
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component

@Component
class UploadSessionExpirationScheduler(
    private val expirationService: UploadSessionExpirationService,
) {
    @Scheduled(fixedDelayString = $$"${file-upload.scheduling.expiration-delay:60000}")
    fun runExpiration(): Int = expirationService.expireSessions()
}
