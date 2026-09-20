package monitoring

import (
	"net/http"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/AndrewTinyakov/file-upload-system/workers/internal/worker"
)

type WorkerMetrics struct {
	handler            http.Handler
	processingDuration prometheus.Observer
	processingAttempts *prometheus.CounterVec
	retries            prometheus.Counter
	retriesAtLimit     prometheus.Counter
}

func NewWorkerMetrics(registry *prometheus.Registry) *WorkerMetrics {
	processingDuration := prometheus.NewHistogram(prometheus.HistogramOpts{
		Name:    "file_upload_worker_processing_duration_seconds",
		Help:    "Time spent processing preparation attempts.",
		Buckets: []float64{0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300},
	})
	processingAttempts := prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "file_upload_worker_processing_attempts_total",
		Help: "Preparation attempts partitioned by bounded outcome.",
	}, []string{"outcome"})
	for _, outcome := range []worker.ProcessingOutcome{
		worker.ProcessingSucceeded,
		worker.ProcessingPermanentFailure,
		worker.ProcessingRetryableFailure,
	} {
		processingAttempts.WithLabelValues(string(outcome))
	}
	retries := prometheus.NewCounter(prometheus.CounterOpts{
		Name: "file_upload_worker_retries_total",
		Help: "Failed job deliveries returned to RabbitMQ for retry.",
	})
	retriesAtLimit := prometheus.NewCounter(prometheus.CounterOpts{
		Name: "file_upload_worker_retries_at_delivery_limit_total",
		Help: "Retry requests issued when the current RabbitMQ delivery count has reached its limit.",
	})
	registry.MustRegister(
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
		processingDuration,
		processingAttempts,
		retries,
		retriesAtLimit,
	)
	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.HandlerFor(registry, promhttp.HandlerOpts{}))
	return &WorkerMetrics{
		handler:            mux,
		processingDuration: processingDuration,
		processingAttempts: processingAttempts,
		retries:            retries,
		retriesAtLimit:     retriesAtLimit,
	}
}

func (metrics *WorkerMetrics) Handler() http.Handler {
	return metrics.handler
}

func (metrics *WorkerMetrics) ObserveProcessing(duration time.Duration, outcome worker.ProcessingOutcome) {
	metrics.processingDuration.Observe(duration.Seconds())
	metrics.processingAttempts.WithLabelValues(string(outcome)).Inc()
}

func (metrics *WorkerMetrics) ObserveRetry(willDeadLetter bool) {
	metrics.retries.Inc()
	if willDeadLetter {
		metrics.retriesAtLimit.Inc()
	}
}
