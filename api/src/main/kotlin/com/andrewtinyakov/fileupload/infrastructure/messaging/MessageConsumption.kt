package com.andrewtinyakov.fileupload.infrastructure.messaging

import com.rabbitmq.client.Channel
import org.slf4j.Logger
import org.springframework.amqp.core.Message
import tools.jackson.core.JacksonException

internal fun consumeMessage(
    message: Message,
    channel: Channel,
    logger: Logger,
    action: () -> Unit,
) {
    val tag = message.messageProperties.deliveryTag
    try {
        action()
    } catch (exception: Exception) {
        val permanent = exception is IllegalArgumentException || exception is JacksonException
        logger.error(
            "Message handling failed: routingKey={}, permanent={}",
            message.messageProperties.receivedRoutingKey,
            permanent,
            exception,
        )
        channel.basicReject(
            tag,
            !permanent,
        )
        return
    }
    channel.basicAck(
        tag,
        false,
    )
}
