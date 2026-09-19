package com.andrewtinyakov.fileupload.asset.integration

import org.springframework.boot.context.properties.ConfigurationProperties
import java.net.URI

@ConfigurationProperties("file-upload.storage")
data class StorageProperties(
    val endpoint: URI = URI("http://localhost:9000"),
    val publicEndpoint: URI = endpoint,
    val publicAssetsBaseUrl: String? = null,
    val region: String = "us-east-1",
    val accessKey: String = "file_upload",
    val secretKey: String = "file_upload",
    val pathStyleAccess: Boolean = true,
    val uploadsBucket: String = "uploads",
    val assetsBucket: String = "assets",
)
