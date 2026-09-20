package com.andrewtinyakov.fileupload.asset.monitoring

import com.andrewtinyakov.fileupload.asset.model.HandlingMode
import com.andrewtinyakov.fileupload.asset.model.UploadStrategy
import com.andrewtinyakov.fileupload.asset.monitoring.dto.UploadSessionEvent
import io.micrometer.core.instrument.Counter
import io.micrometer.core.instrument.MeterRegistry
import org.springframework.stereotype.Component

@Component
class UploadSessionMetrics(
    registry: MeterRegistry,
) {
    private val sessionCounters = UploadStrategy.entries.flatMap { strategy ->
        UploadSessionEvent.entries.map { event ->
            (strategy to event) to Counter.builder("file.upload.session.events")
                .description("Upload session lifecycle events.")
                .tag("event", event.metricValue())
                .tag("strategy", strategy.metricValue())
                .register(registry)
        }
    }.toMap()
    private val acceptedByteCounters = HandlingMode.entries.associateWith { handlingMode ->
        Counter.builder("file.upload.accepted.bytes")
            .description("Bytes accepted when upload sessions are created.")
            .baseUnit("bytes")
            .tag("handling_mode", handlingMode.metricValue())
            .register(registry)
    }
    private val completedByteCounters = HandlingMode.entries.flatMap { handlingMode ->
        UploadStrategy.entries.map { strategy ->
            (handlingMode to strategy) to Counter.builder("file.upload.completed.bytes")
                .description("Bytes verified when upload sessions complete.")
                .baseUnit("bytes")
                .tag("handling_mode", handlingMode.metricValue())
                .tag("strategy", strategy.metricValue())
                .register(registry)
        }
    }.toMap()

    fun sessionCreated(
        handlingMode: HandlingMode,
        strategy: UploadStrategy,
        byteSize: Long,
    ) {
        session(strategy, UploadSessionEvent.CREATED)
        acceptedByteCounters.getValue(handlingMode).increment(byteSize.toDouble())
    }

    fun sessionCompleted(
        handlingMode: HandlingMode,
        strategy: UploadStrategy,
        byteSize: Long,
    ) {
        session(strategy, UploadSessionEvent.COMPLETED)
        completedByteCounters.getValue(handlingMode to strategy).increment(byteSize.toDouble())
    }

    fun sessionAborted(strategy: UploadStrategy) = session(strategy, UploadSessionEvent.ABORTED)

    fun sessionExpired(strategy: UploadStrategy) = session(strategy, UploadSessionEvent.EXPIRED)

    private fun session(
        strategy: UploadStrategy,
        event: UploadSessionEvent,
    ) {
        sessionCounters.getValue(strategy to event).increment()
    }
}
