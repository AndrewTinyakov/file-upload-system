package com.andrewtinyakov.fileupload.infrastructure.messaging

class MessageRoute internal constructor(
    val exchange: String,
    val routingKey: String,
)
