package com.andrewtinyakov.fileupload.infrastructure.outbox

import com.andrewtinyakov.fileupload.infrastructure.database.generated.tables.OutboxMessages.OUTBOX_MESSAGES
import com.andrewtinyakov.fileupload.infrastructure.database.generated.tables.records.OutboxMessagesRecord
import org.jooq.DSLContext
import org.jooq.JSONB
import org.springframework.stereotype.Repository
import java.time.OffsetDateTime

@Repository
class JooqOutboxRepository(
    private val db: DSLContext,
) : OutboxRepository {
    override fun findUnpublishedForUpdate(limit: Int): List<OutboxMessage> =
        db
            .selectFrom(OUTBOX_MESSAGES)
            .where(OUTBOX_MESSAGES.PUBLISHED_AT.isNull)
            .orderBy(
                OUTBOX_MESSAGES.CREATED_AT,
                OUTBOX_MESSAGES.ID,
            ).limit(limit)
            .forUpdate()
            .skipLocked()
            .fetch()
            .map { it.toModel() }

    override fun markPublished(
        ids: Collection<String>,
        publishedAt: OffsetDateTime,
    ) {
        val updated = db
            .update(OUTBOX_MESSAGES)
            .set(
                OUTBOX_MESSAGES.PUBLISHED_AT,
                publishedAt,
            ).where(
                OUTBOX_MESSAGES.ID.`in`(ids),
                OUTBOX_MESSAGES.PUBLISHED_AT.isNull,
            ).execute()
        check(updated == ids.size) {
            "Expected to mark ${ids.size} outbox messages as published, updated $updated"
        }
    }

    override fun enqueue(messages: Collection<OutboxMessage>) {
        if (messages.isEmpty()) {
            return
        }
        require(messages.all { it.status == OutboxMessageStatus.PENDING })
        val insert = db.insertInto(
            OUTBOX_MESSAGES,
            OUTBOX_MESSAGES.ID,
            OUTBOX_MESSAGES.AGGREGATE_TYPE,
            OUTBOX_MESSAGES.AGGREGATE_ID,
            OUTBOX_MESSAGES.MESSAGE_TYPE,
            OUTBOX_MESSAGES.EXCHANGE_NAME,
            OUTBOX_MESSAGES.ROUTING_KEY,
            OUTBOX_MESSAGES.PAYLOAD,
        )
        messages.forEach { message ->
            insert.values(
                message.id,
                message.aggregateType,
                message.aggregateId,
                message.type,
                message.exchange,
                message.routingKey,
                JSONB.valueOf(message.payload),
            )
        }
        val inserted = insert.execute()
        check(inserted == messages.size) {
            "Expected to enqueue ${messages.size} outbox messages, inserted $inserted"
        }
    }
}

private fun OutboxMessagesRecord.toModel() =
    OutboxMessage(
        id = id!!,
        aggregateType = aggregateType!!,
        aggregateId = aggregateId!!,
        exchange = exchangeName!!,
        routingKey = routingKey!!,
        type = messageType!!,
        payload = payload!!.data(),
        status = if (publishedAt == null) {
            OutboxMessageStatus.PENDING
        } else {
            OutboxMessageStatus.PUBLISHED
        },
    )
