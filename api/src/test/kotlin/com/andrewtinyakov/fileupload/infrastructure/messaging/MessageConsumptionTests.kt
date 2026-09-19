package com.andrewtinyakov.fileupload.infrastructure.messaging

import com.rabbitmq.client.Channel
import org.junit.jupiter.api.Test
import org.mockito.Mockito
import org.slf4j.Logger
import org.springframework.amqp.core.Message
import org.springframework.amqp.core.MessageProperties
import org.springframework.dao.TransientDataAccessResourceException
import tools.jackson.databind.ObjectMapper
import java.io.IOException
import kotlin.test.assertFailsWith
import kotlin.test.assertSame
import kotlin.test.assertTrue

class MessageConsumptionTests {
    private val channel = Mockito.mock(Channel::class.java)
    private val logger = Mockito.mock(Logger::class.java)
    private val tag = 42L
    private val message = Message(
        byteArrayOf(),
        MessageProperties().apply {
            deliveryTag = tag
            receivedRoutingKey = "asset.preparation.completed.v1"
        },
    )

    @Test
    fun `successful message is acknowledged`() {
        var processed = false

        consumeMessage(message, channel, logger) {
            Mockito.verifyNoInteractions(channel)
            processed = true
        }

        assertTrue(processed)
        Mockito.verify(channel).basicAck(tag, false)
        Mockito.verifyNoMoreInteractions(channel)
    }

    @Test
    fun `invalid message is rejected`() {
        consumeMessage(message, channel, logger) {
            throw IllegalArgumentException("Invalid object key")
        }

        Mockito.verify(channel).basicReject(tag, false)
        Mockito.verifyNoMoreInteractions(channel)
    }

    @Test
    fun `malformed message is rejected`() {
        consumeMessage(message, channel, logger) {
            ObjectMapper().readTree("{")
        }

        Mockito.verify(channel).basicReject(tag, false)
        Mockito.verifyNoMoreInteractions(channel)
    }

    @Test
    fun `temporary failure returns the message to the queue`() {
        consumeMessage(message, channel, logger) {
            throw TransientDataAccessResourceException("Database temporarily unavailable")
        }

        Mockito.verify(channel).basicReject(tag, true)
        Mockito.verifyNoMoreInteractions(channel)
    }

    @Test
    fun `error leaves the message unacknowledged`() {
        val error = AssertionError("Processing failed")

        val thrown = assertFailsWith<AssertionError> {
            consumeMessage(message, channel, logger) { throw error }
        }

        assertSame(error, thrown)
        Mockito.verifyNoInteractions(channel)
    }

    @Test
    fun `acknowledgement failure reaches the caller`() {
        val failure = IOException("Channel closed")
        Mockito.doThrow(failure).`when`(channel).basicAck(tag, false)

        val thrown = assertFailsWith<IOException> {
            consumeMessage(message, channel, logger) {}
        }

        assertSame(failure, thrown)
        Mockito.verify(channel).basicAck(tag, false)
        Mockito.verifyNoMoreInteractions(channel)
    }

    @Test
    fun `rejection failure reaches the caller`() {
        val failure = IOException("Channel closed")
        Mockito.doThrow(failure).`when`(channel).basicReject(tag, true)

        val thrown = assertFailsWith<IOException> {
            consumeMessage(message, channel, logger) {
                throw TransientDataAccessResourceException("Database temporarily unavailable")
            }
        }

        assertSame(failure, thrown)
        Mockito.verify(channel).basicReject(tag, true)
        Mockito.verifyNoMoreInteractions(channel)
    }
}
