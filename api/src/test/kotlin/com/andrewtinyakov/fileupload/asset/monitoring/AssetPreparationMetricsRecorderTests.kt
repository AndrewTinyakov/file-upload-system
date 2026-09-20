package com.andrewtinyakov.fileupload.asset.monitoring

import com.andrewtinyakov.fileupload.MutableClock
import com.andrewtinyakov.fileupload.asset.model.HandlingMode
import io.micrometer.prometheusmetrics.PrometheusConfig
import io.micrometer.prometheusmetrics.PrometheusMeterRegistry
import java.time.OffsetDateTime
import java.time.ZoneOffset
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals

class AssetPreparationMetricsRecorderTests {
    private val clock = MutableClock()
    private val now = clock.instant()
    private val registry = PrometheusMeterRegistry(PrometheusConfig.DEFAULT)
    private val metricsRecorder = AssetPreparationMetricsRecorder(registry)

    @Test
    fun `preparation results and phase durations are exposed for Prometheus`() {
        val preparationStartedAt = OffsetDateTime.ofInstant(now.minusSeconds(30), ZoneOffset.UTC)
        val workerStartedAt = OffsetDateTime.ofInstant(now.minusSeconds(20), ZoneOffset.UTC)
        val workerFinishedAt = OffsetDateTime.ofInstant(now.minusSeconds(10), ZoneOffset.UTC)
        val receivedAt = OffsetDateTime.ofInstant(now, ZoneOffset.UTC)
        metricsRecorder.preparationCompleted(
            HandlingMode.IMAGE,
            preparationStartedAt,
            workerStartedAt,
            workerFinishedAt,
            receivedAt,
        )
        metricsRecorder.preparationFailed(
            HandlingMode.IMAGE,
            preparationStartedAt,
            workerStartedAt,
            workerFinishedAt,
            receivedAt,
        )

        val scrape = registry.scrape()

        assertContains(
            scrape,
            "file_upload_preparations_total{handling_mode=\"image\",outcome=\"completed\"} 1.0",
        )
        assertContains(
            scrape,
            "file_upload_preparations_total{handling_mode=\"image\",outcome=\"failed\"} 1.0",
        )
        assertContains(
            scrape,
            "file_upload_preparation_dispatch_duration_seconds_count{handling_mode=\"image\",outcome=\"completed\"} 1",
        )
        assertContains(
            scrape,
            "file_upload_preparation_dispatch_duration_seconds_sum{handling_mode=\"image\",outcome=\"completed\"} 10.0",
        )
        assertContains(
            scrape,
            "file_upload_preparation_result_delivery_duration_seconds_count{handling_mode=\"image\",outcome=\"completed\"} 1",
        )
        assertContains(
            scrape,
            "file_upload_preparation_result_delivery_duration_seconds_sum{handling_mode=\"image\",outcome=\"completed\"} 10.0",
        )
    }

    @Test
    fun `negative phase durations count results without recording invalid durations`() {
        val preparationStartedAt = OffsetDateTime.ofInstant(now, ZoneOffset.UTC)
        val workerStartedAt = OffsetDateTime.ofInstant(now.minusSeconds(1), ZoneOffset.UTC)
        val workerFinishedAt = OffsetDateTime.ofInstant(now.plusSeconds(1), ZoneOffset.UTC)
        val receivedAt = OffsetDateTime.ofInstant(now, ZoneOffset.UTC)
        metricsRecorder.preparationCompleted(
            HandlingMode.IMAGE,
            preparationStartedAt,
            workerStartedAt,
            workerFinishedAt,
            receivedAt,
        )

        assertEquals(
            1.0,
            registry.get("file.upload.preparations")
                .tags("handling_mode", "image", "outcome", "completed")
                .counter()
                .count(),
        )
        assertEquals(
            0,
            registry.get("file.upload.preparation.dispatch.duration")
                .tags("handling_mode", "image", "outcome", "completed")
                .timer()
                .count(),
        )
        assertEquals(
            0,
            registry.get("file.upload.preparation.result.delivery.duration")
                .tags("handling_mode", "image", "outcome", "completed")
                .timer()
                .count(),
        )
    }
}
