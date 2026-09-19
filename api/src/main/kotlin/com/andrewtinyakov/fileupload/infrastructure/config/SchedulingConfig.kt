package com.andrewtinyakov.fileupload.infrastructure.config

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.context.annotation.Configuration
import org.springframework.scheduling.annotation.EnableScheduling
import java.time.Duration

@ConfigurationProperties("file-upload.scheduling")
data class SchedulingProperties(
    val batchSize: Int = 20,
    val maxBatchesPerRun: Int = 10,
    val cleanupGracePeriod: Duration = Duration.ofHours(24),
) {
    init {
        require(
            batchSize in 1..1000 && maxBatchesPerRun > 0 && !cleanupGracePeriod.isNegative,
        )
    }
}

@Configuration(proxyBeanMethods = false)
@EnableScheduling
@ConditionalOnProperty(
    prefix = "file-upload.scheduling",
    name = ["enabled"],
    havingValue = "true",
    matchIfMissing = true,
)
class SchedulingConfig
