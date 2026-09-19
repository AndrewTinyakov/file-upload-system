package com.andrewtinyakov.fileupload.asset.integration.dto

data class PresignedRequest(
    val url: String,
    val method: String,
    val headers: Map<String, String>,
)
