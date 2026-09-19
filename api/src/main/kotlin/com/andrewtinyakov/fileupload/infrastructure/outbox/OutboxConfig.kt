package com.andrewtinyakov.fileupload.infrastructure.outbox

import org.springframework.boot.context.properties.ConfigurationProperties
import java.time.Duration

@ConfigurationProperties("file-upload.outbox")
data class OutboxConfig(
    val confirmTimeout: Duration = Duration.ofSeconds(5),
    val maxBatchesPerRun: Int = 10,
) {
    init {
        require(!confirmTimeout.isNegative && !confirmTimeout.isZero && maxBatchesPerRun > 0)
    }
}
