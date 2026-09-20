package com.andrewtinyakov.fileupload.asset.monitoring

import com.andrewtinyakov.fileupload.asset.model.HandlingMode
import com.andrewtinyakov.fileupload.asset.model.UploadStrategy
import io.micrometer.prometheusmetrics.PrometheusConfig
import io.micrometer.prometheusmetrics.PrometheusMeterRegistry
import kotlin.test.Test
import kotlin.test.assertContains

class UploadSessionMetricsTests {
    private val registry = PrometheusMeterRegistry(PrometheusConfig.DEFAULT)
    private val metrics = UploadSessionMetrics(registry)

    @Test
    fun `upload lifecycle and byte metrics are exposed for Prometheus`() {
        metrics.sessionCreated(HandlingMode.IMAGE, UploadStrategy.MULTIPART, 42)
        metrics.sessionCompleted(HandlingMode.IMAGE, UploadStrategy.MULTIPART, 40)
        metrics.sessionAborted(UploadStrategy.MULTIPART)
        metrics.sessionExpired(UploadStrategy.MULTIPART)

        val scrape = registry.scrape()

        assertContains(
            scrape,
            "file_upload_session_events_total{event=\"created\",strategy=\"multipart\"} 1.0",
        )
        assertContains(
            scrape,
            "file_upload_session_events_total{event=\"completed\",strategy=\"multipart\"} 1.0",
        )
        assertContains(
            scrape,
            "file_upload_session_events_total{event=\"aborted\",strategy=\"multipart\"} 1.0",
        )
        assertContains(
            scrape,
            "file_upload_session_events_total{event=\"expired\",strategy=\"multipart\"} 1.0",
        )
        assertContains(scrape, "file_upload_accepted_bytes_total{handling_mode=\"image\"} 42.0")
        assertContains(
            scrape,
            "file_upload_completed_bytes_total{handling_mode=\"image\",strategy=\"multipart\"} 40.0",
        )
        assertContains(
            scrape,
            "file_upload_session_events_total{event=\"expired\",strategy=\"single\"} 0.0",
        )
        assertContains(scrape, "file_upload_accepted_bytes_total{handling_mode=\"document\"} 0.0")
        assertContains(
            scrape,
            "file_upload_completed_bytes_total{handling_mode=\"document\",strategy=\"single\"} 0.0",
        )
    }
}
