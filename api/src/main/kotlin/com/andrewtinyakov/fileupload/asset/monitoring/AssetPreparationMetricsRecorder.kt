package com.andrewtinyakov.fileupload.asset.monitoring

import com.andrewtinyakov.fileupload.asset.model.HandlingMode
import com.andrewtinyakov.fileupload.asset.monitoring.dto.PreparationOutcome
import io.micrometer.core.instrument.Counter
import io.micrometer.core.instrument.MeterRegistry
import io.micrometer.core.instrument.Timer
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Component
import java.time.Duration
import java.time.OffsetDateTime

@Component
class AssetPreparationMetricsRecorder(
    registry: MeterRegistry,
) {
    private val logger = LoggerFactory.getLogger(javaClass)
    private val counters = HandlingMode.entries.flatMap { handlingMode ->
        PreparationOutcome.entries.map { outcome ->
            (handlingMode to outcome) to Counter.builder("file.upload.preparations")
                .description("Preparation results applied to file assets.")
                .tag("handling_mode", handlingMode.metricValue())
                .tag("outcome", outcome.metricValue())
                .register(registry)
        }
    }.toMap()
    private val dispatchTimers = HandlingMode.entries.flatMap { handlingMode ->
        PreparationOutcome.entries.map { outcome ->
            (handlingMode to outcome) to Timer.builder("file.upload.preparation.dispatch.duration")
                .description("Time from preparation dispatch until a worker starts processing.")
                .tag("handling_mode", handlingMode.metricValue())
                .tag("outcome", outcome.metricValue())
                .serviceLevelObjectives(
                    Duration.ofMillis(100),
                    Duration.ofMillis(250),
                    Duration.ofMillis(500),
                    Duration.ofSeconds(1),
                    Duration.ofSeconds(5),
                    Duration.ofSeconds(10),
                    Duration.ofSeconds(30),
                    Duration.ofMinutes(1),
                    Duration.ofMinutes(2),
                    Duration.ofMinutes(5),
                    Duration.ofMinutes(10),
                    Duration.ofMinutes(15),
                )
                .register(registry)
        }
    }.toMap()
    private val deliveryTimers = HandlingMode.entries.flatMap { handlingMode ->
        PreparationOutcome.entries.map { outcome ->
            (handlingMode to outcome) to Timer.builder("file.upload.preparation.result.delivery.duration")
                .description("Time from worker completion until the API starts handling the result.")
                .tag("handling_mode", handlingMode.metricValue())
                .tag("outcome", outcome.metricValue())
                .serviceLevelObjectives(
                    Duration.ofMillis(100),
                    Duration.ofSeconds(1),
                    Duration.ofSeconds(5),
                    Duration.ofSeconds(10),
                    Duration.ofSeconds(30),
                    Duration.ofMinutes(1),
                )
                .register(registry)
        }
    }.toMap()

    fun preparationCompleted(
        handlingMode: HandlingMode,
        preparationStartedAt: OffsetDateTime,
        workerStartedAt: OffsetDateTime,
        workerFinishedAt: OffsetDateTime,
        receivedAt: OffsetDateTime,
    ) = record(
        handlingMode = handlingMode,
        outcome = PreparationOutcome.COMPLETED,
        preparationStartedAt = preparationStartedAt,
        workerStartedAt = workerStartedAt,
        workerFinishedAt = workerFinishedAt,
        receivedAt = receivedAt,
    )

    fun preparationFailed(
        handlingMode: HandlingMode,
        preparationStartedAt: OffsetDateTime,
        workerStartedAt: OffsetDateTime,
        workerFinishedAt: OffsetDateTime,
        receivedAt: OffsetDateTime,
    ) = record(
        handlingMode = handlingMode,
        outcome = PreparationOutcome.FAILED,
        preparationStartedAt = preparationStartedAt,
        workerStartedAt = workerStartedAt,
        workerFinishedAt = workerFinishedAt,
        receivedAt = receivedAt,
    )

    fun preparationFailed(handlingMode: HandlingMode) {
        counters.getValue(handlingMode to PreparationOutcome.FAILED).increment()
    }

    private fun record(
        handlingMode: HandlingMode,
        outcome: PreparationOutcome,
        preparationStartedAt: OffsetDateTime,
        workerStartedAt: OffsetDateTime,
        workerFinishedAt: OffsetDateTime,
        receivedAt: OffsetDateTime,
    ) {
        counters.getValue(handlingMode to outcome).increment()
        recordDuration(
            timer = dispatchTimers.getValue(handlingMode to outcome),
            start = preparationStartedAt,
            end = workerStartedAt,
            name = "backend-to-worker",
        )
        recordDuration(
            timer = deliveryTimers.getValue(handlingMode to outcome),
            start = workerFinishedAt,
            end = receivedAt,
            name = "worker-to-backend",
        )
    }

    private fun recordDuration(
        timer: Timer,
        start: OffsetDateTime,
        end: OffsetDateTime,
        name: String,
    ) {
        val duration = Duration.between(start.toInstant(), end.toInstant())
        if (duration.isNegative) {
            logger.warn("Skipping negative {} preparation duration: {} -> {}", name, start, end)
            return
        }
        timer.record(duration)
    }
}
