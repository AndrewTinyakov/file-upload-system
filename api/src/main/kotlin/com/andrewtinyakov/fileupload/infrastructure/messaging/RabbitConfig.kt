package com.andrewtinyakov.fileupload.infrastructure.messaging

import org.springframework.amqp.core.Binding
import org.springframework.amqp.core.Declarable
import org.springframework.amqp.core.Declarables
import org.springframework.amqp.core.Queue
import org.springframework.amqp.core.QueueBuilder
import org.springframework.amqp.core.QueueBuilder.Overflow
import org.springframework.amqp.core.TopicExchange
import org.springframework.boot.context.properties.ConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import java.time.Duration

@ConfigurationProperties("file-upload.messaging")
data class MessagingProperties(
    val deliveryLimit: Int = 5,
    val assetCleanupConcurrency: Int = 4,
    val multipartAbortConcurrency: Int = 4,
) {
    init {
        require(deliveryLimit > 0)
        require(assetCleanupConcurrency > 0)
        require(multipartAbortConcurrency > 0)
    }
}

@Configuration(proxyBeanMethods = false)
class RabbitConfig {
    @Bean
    fun assetTopology(properties: MessagingProperties): Declarables {
        fun bind(
            queue: String,
            exchange: String,
            key: String,
        ) = Binding(
            queue,
            Binding.DestinationType.QUEUE,
            exchange,
            key,
            emptyMap(),
        )

        val declarations = buildList<Declarable> {
            addAll(AssetMessaging.exchanges.map(::TopicExchange))
            for (route in AssetMessaging.queues) {
                add(
                    buildQueue(
                        route,
                        properties.deliveryLimit,
                    ),
                )
                addAll(
                    route.routes.map {
                        bind(
                            route.queue,
                            it.exchange,
                            it.routingKey,
                        )
                    },
                )
            }
        }
        return Declarables(declarations)
    }
}

private const val UNLIMITED_DELIVERIES = -1
private val minimumRetryDelay = Duration.ofSeconds(1)
private val maximumRetryDelay = Duration.ofSeconds(30)

private fun buildQueue(
    route: QueueRoute,
    deliveryLimit: Int,
): Queue {
    val builder = QueueBuilder.durable(route.queue).quorum()
    val configured = when (route.failurePolicy) {
        QueueFailurePolicy.DEAD_LETTER_AFTER_LIMIT -> {
            builder.deliveryLimit(deliveryLimit).withAtLeastOnceDeadLettering(AssetMessaging.Exchanges.DEAD)
        }

        QueueFailurePolicy.RETRY_INDEFINITELY -> {
            builder.deliveryLimit(UNLIMITED_DELIVERIES)
        }
    }
    return configured
        .withFailedDeliveryRetry(
            minimumRetryDelay,
            maximumRetryDelay,
        ).build()
}

private fun QueueBuilder.withAtLeastOnceDeadLettering(exchange: String): QueueBuilder =
    deadLetterExchange(exchange).overflow(Overflow.rejectPublish).withArgument(
        "x-dead-letter-strategy",
        "at-least-once",
    )

private fun QueueBuilder.withFailedDeliveryRetry(
    minimum: Duration,
    maximum: Duration,
): QueueBuilder {
    require(!minimum.isNegative && !minimum.isZero && maximum >= minimum)
    return withArgument(
        "x-delayed-retry-type",
        "failed",
    ).withArgument(
        "x-delayed-retry-min",
        Math.toIntExact(minimum.toMillis()),
    ).withArgument(
        "x-delayed-retry-max",
        Math.toIntExact(maximum.toMillis()),
    )
}
