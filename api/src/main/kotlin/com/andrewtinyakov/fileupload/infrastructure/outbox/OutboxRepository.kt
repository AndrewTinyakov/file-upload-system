package com.andrewtinyakov.fileupload.infrastructure.outbox

import java.time.OffsetDateTime

interface OutboxRepository {
    fun findUnpublishedForUpdate(limit: Int): List<OutboxMessage>

    fun markPublished(
        ids: Collection<String>,
        publishedAt: OffsetDateTime,
    )

    fun enqueue(messages: Collection<OutboxMessage>)
}
