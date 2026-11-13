package com.andrewtinyakov.fileupload.shared.monitoring

import org.slf4j.LoggerFactory
import java.time.Instant

object SampledUploadTrace {
    private val logger = LoggerFactory.getLogger(SampledUploadTrace::class.java)
    private const val ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

    fun record(assetId: String, stage: String) {
        val suffix = assetId.takeLast(2).fold(0) { total, char -> total * 32 + ALPHABET.indexOf(char) }
        if (suffix % 100 == 0) {
            logger.info("upload_trace asset_id={} stage={} at={}", assetId, stage, Instant.now())
        }
    }
}
