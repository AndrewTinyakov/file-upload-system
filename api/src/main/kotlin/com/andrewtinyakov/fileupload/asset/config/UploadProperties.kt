package com.andrewtinyakov.fileupload.asset.config

import org.springframework.boot.context.properties.ConfigurationProperties
import java.time.Duration

@ConfigurationProperties("file-upload.upload")
data class UploadProperties(
    val maxDocumentSize: Long = 5L * 1024 * 1024 * 1024,
    val maxImageSize: Long = 50L * 1024 * 1024,
    val multipartThreshold: Long = 64L * 1024 * 1024,
    val partSize: Long = 8L * 1024 * 1024,
    val maxPartsPerRequest: Int = 100,
    val sessionLifetime: Duration = Duration.ofHours(6),
    val signedUrlLifetime: Duration = Duration.ofMinutes(15),
    val processingProfileName: String = "default-image",
    val processingProfileVersion: Int = 1,
) {
    init {
        require(maxDocumentSize >= 0 && maxImageSize > 0)
        require(multipartThreshold in 1..5L * 1024 * 1024 * 1024)
        require(partSize in 5L * 1024 * 1024..5L * 1024 * 1024 * 1024)
        require(maxDocumentSize / partSize < 10000 && maxImageSize / partSize < 10000)
        require(maxPartsPerRequest in 1..10000)
        require(
            !sessionLifetime.isNegative && !sessionLifetime.isZero && sessionLifetime < Duration.ofDays(1),
        )
        require(
            !signedUrlLifetime.isNegative && !signedUrlLifetime.isZero && signedUrlLifetime <= Duration.ofDays(7),
        )
        require(processingProfileName.isNotBlank() && processingProfileVersion > 0)
    }
}
