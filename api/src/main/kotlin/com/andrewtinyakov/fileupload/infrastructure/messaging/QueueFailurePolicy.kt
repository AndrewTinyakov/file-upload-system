package com.andrewtinyakov.fileupload.infrastructure.messaging

internal enum class QueueFailurePolicy {
    DEAD_LETTER_AFTER_LIMIT,
    RETRY_INDEFINITELY,
}
