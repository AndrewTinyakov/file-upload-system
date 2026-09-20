package monitoring

import (
	"io"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/AndrewTinyakov/file-upload-system/workers/internal/worker"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

func TestWorkerMetricsAreExposedForPrometheus(t *testing.T) {
	registry := prometheus.NewRegistry()
	metrics := NewWorkerMetrics(registry)
	metrics.ObserveProcessing(250*time.Millisecond, worker.ProcessingSucceeded)
	metrics.ObserveProcessing(500*time.Millisecond, worker.ProcessingPermanentFailure)
	metrics.ObserveProcessing(750*time.Millisecond, worker.ProcessingRetryableFailure)
	metrics.ObserveRetry(false)
	metrics.ObserveRetry(true)
	if problems, err := testutil.GatherAndLint(registry); err != nil || len(problems) != 0 {
		t.Fatalf("metric lint problems = %v, error = %v", problems, err)
	}
	expected := strings.NewReader(`
# HELP file_upload_worker_processing_attempts_total Preparation attempts partitioned by bounded outcome.
# TYPE file_upload_worker_processing_attempts_total counter
file_upload_worker_processing_attempts_total{outcome="permanent_failure"} 1
file_upload_worker_processing_attempts_total{outcome="retryable_failure"} 1
file_upload_worker_processing_attempts_total{outcome="succeeded"} 1
# HELP file_upload_worker_retries_at_delivery_limit_total Retry requests issued when the current RabbitMQ delivery count has reached its limit.
# TYPE file_upload_worker_retries_at_delivery_limit_total counter
file_upload_worker_retries_at_delivery_limit_total 1
# HELP file_upload_worker_retries_total Failed job deliveries returned to RabbitMQ for retry.
# TYPE file_upload_worker_retries_total counter
file_upload_worker_retries_total 2
`)
	if err := testutil.GatherAndCompare(
		registry,
		expected,
		"file_upload_worker_processing_attempts_total",
		"file_upload_worker_retries_at_delivery_limit_total",
		"file_upload_worker_retries_total",
	); err != nil {
		t.Fatal(err)
	}

	request := httptest.NewRequest("GET", "/metrics", nil)
	response := httptest.NewRecorder()
	metrics.Handler().ServeHTTP(response, request)
	body, err := io.ReadAll(response.Result().Body)
	if err != nil {
		t.Fatal(err)
	}
	scrape := string(body)

	want := []string{
		`file_upload_worker_processing_duration_seconds_count 3`,
		`file_upload_worker_processing_attempts_total{outcome="succeeded"} 1`,
		`file_upload_worker_processing_attempts_total{outcome="permanent_failure"} 1`,
		`file_upload_worker_processing_attempts_total{outcome="retryable_failure"} 1`,
		`file_upload_worker_retries_total 2`,
		`file_upload_worker_retries_at_delivery_limit_total 1`,
	}
	for _, metric := range want {
		if !strings.Contains(scrape, metric) {
			t.Errorf("scrape does not contain %q\n%s", metric, scrape)
		}
	}
}
