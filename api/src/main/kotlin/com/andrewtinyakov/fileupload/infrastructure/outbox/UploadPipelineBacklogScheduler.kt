package com.andrewtinyakov.fileupload.infrastructure.outbox

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component

@Component
@ConditionalOnProperty(prefix = "file-upload.monitoring", name = ["backlog-enabled"], havingValue = "true")
class UploadPipelineBacklogScheduler(
    private val metrics: UploadPipelineBacklogMetrics,
) {
    @Scheduled(fixedDelay = 1000)
    fun sample() = metrics.sample()
}
