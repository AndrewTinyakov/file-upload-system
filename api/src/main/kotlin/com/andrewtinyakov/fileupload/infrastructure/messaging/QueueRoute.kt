package com.andrewtinyakov.fileupload.infrastructure.messaging

internal data class QueueRoute(
    val queue: String,
    val routes: Set<MessageRoute>,
    val failurePolicy: QueueFailurePolicy,
)
