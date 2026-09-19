package com.andrewtinyakov.fileupload.infrastructure.outbox

import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component

@Component
class OutboxPublishingScheduler(
    private val outboxService: OutboxService,
) {
    @Scheduled(
        fixedDelayString = $$"${file-upload.outbox.poll-delay:500}",
    )
    fun publishPending(): Int = outboxService.publishPending()
}
