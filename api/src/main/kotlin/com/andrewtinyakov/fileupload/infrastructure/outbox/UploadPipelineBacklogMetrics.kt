package com.andrewtinyakov.fileupload.infrastructure.outbox

import io.micrometer.core.instrument.Gauge
import io.micrometer.core.instrument.MeterRegistry
import org.jooq.DSLContext
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.stereotype.Component
import java.util.concurrent.atomic.AtomicReference

@Component
@ConditionalOnProperty(prefix = "file-upload.monitoring", name = ["backlog-enabled"], havingValue = "true")
class UploadPipelineBacklogMetrics(
    private val database: DSLContext,
    registry: MeterRegistry,
) {
    private val outboxPending = AtomicReference(0.0)
    private val outboxOldestAgeSeconds = AtomicReference(0.0)
    private val preparingAssets = AtomicReference(0.0)
    private val incompleteSessions = AtomicReference(0.0)

    init {
        Gauge.builder("file.upload.outbox.pending", outboxPending) { it.get() }
            .description("Unpublished durable outbox messages.")
            .register(registry)
        Gauge.builder("file.upload.outbox.oldest.age.seconds", outboxOldestAgeSeconds) { it.get() }
            .description("Age of the oldest unpublished outbox message, zero when empty.")
            .register(registry)
        Gauge.builder("file.upload.preparing", preparingAssets) { it.get() }
            .description("Assets awaiting a durable preparation result.")
            .register(registry)
        Gauge.builder("file.upload.incomplete", incompleteSessions) { it.get() }
            .description("Upload sessions that have not completed, aborted or expired.")
            .register(registry)
    }

    fun sample() {
        val record = database.fetchOne(
            """
            SELECT count(*)::double precision AS depth,
                   coalesce(extract(epoch FROM current_timestamp - min(created_at)), 0)::double precision AS age,
                   (SELECT count(*) FROM file_assets WHERE status = 'PREPARING')::double precision AS preparing,
                   (SELECT count(*) FROM upload_sessions WHERE status = 'CREATED')::double precision AS incomplete
            FROM outbox_messages
            WHERE published_at IS NULL
            """.trimIndent(),
        ) ?: return
        outboxPending.set(record.get("depth", Double::class.java))
        outboxOldestAgeSeconds.set(record.get("age", Double::class.java).coerceAtLeast(0.0))
        preparingAssets.set(record.get("preparing", Double::class.java))
        incompleteSessions.set(record.get("incomplete", Double::class.java))
    }
}
