package com.andrewtinyakov.fileupload.infrastructure.outbox

data class OutboxMessage(
    val id: String,
    val aggregateType: String,
    val aggregateId: String,
    val exchange: String,
    val routingKey: String,
    val type: String,
    val payload: String,
    val status: OutboxMessageStatus,
)
