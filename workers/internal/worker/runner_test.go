package worker

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type testConsumer struct {
	deliveries <-chan Delivery
}

func (consumer testConsumer) Deliveries(context.Context) (<-chan Delivery, error) {
	return consumer.deliveries, nil
}

type testDelivery struct {
	payload       []byte
	deliveryCount int64
	acked         atomic.Bool
	retried       atomic.Bool
	onRetry       func()
}

func (delivery *testDelivery) Body() []byte {
	return delivery.payload
}

func (delivery *testDelivery) DeliveryCount() int64 {
	return delivery.deliveryCount
}

func (delivery *testDelivery) Ack() error {
	delivery.acked.Store(true)
	return nil
}

func (delivery *testDelivery) Retry() error {
	delivery.retried.Store(true)
	if delivery.onRetry != nil {
		delivery.onRetry()
	}
	return nil
}

func TestRunnerProcessesJobsConcurrently(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	deliveries := make(chan Delivery, 4)
	items := []*testDelivery{
		{payload: []byte("one")},
		{payload: []byte("two")},
		{payload: []byte("three")},
		{payload: []byte("four")},
	}
	for _, delivery := range items {
		deliveries <- delivery
	}

	started := make(chan struct{}, len(items))
	release := make(chan struct{})
	var handled atomic.Int32
	runner := Runner{
		Consumer:    testConsumer{deliveries: deliveries},
		Concurrency: len(items),
		Handler: HandlerFunc(func(context.Context, []byte) error {
			started <- struct{}{}
			<-release
			if handled.Add(1) == int32(len(items)) {
				cancel()
			}
			return nil
		}),
	}

	var runErr error
	var runDone sync.WaitGroup
	runDone.Go(func() {
		runErr = runner.Run(ctx)
	})

	for range items {
		<-started
	}
	close(release)
	runDone.Wait()

	if runErr != nil {
		t.Fatalf("Run() error = %v", runErr)
	}
	for _, delivery := range items {
		if !delivery.acked.Load() {
			t.Fatal("delivery was not acknowledged")
		}
		if delivery.retried.Load() {
			t.Fatal("successful delivery was retried")
		}
	}
}

func TestRunnerRetriesHandlerFailure(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	deliveries := make(chan Delivery, 1)
	delivery := &testDelivery{payload: []byte("job")}
	deliveries <- delivery

	runner := Runner{
		Consumer:    testConsumer{deliveries: deliveries},
		Concurrency: 1,
		Handler: HandlerFunc(func(context.Context, []byte) error {
			cancel()
			return errors.New("temporary failure")
		}),
	}

	if err := runner.Run(ctx); err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if !delivery.retried.Load() {
		t.Fatal("delivery was not retried")
	}
	if delivery.acked.Load() {
		t.Fatal("failed delivery was acknowledged")
	}
}

func TestRunnerRecordsRetryThatWillExceedDeliveryLimit(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	deliveries := make(chan Delivery, 1)
	delivery := &testDelivery{payload: []byte("job"), deliveryCount: 5}
	deliveries <- delivery
	metrics := &retryMetrics{}
	runner := Runner{
		Consumer:      testConsumer{deliveries: deliveries},
		Concurrency:   1,
		DeliveryLimit: 5,
		Metrics:       metrics,
		Handler: HandlerFunc(func(context.Context, []byte) error {
			cancel()
			return errors.New("temporary failure")
		}),
	}

	if err := runner.Run(ctx); err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if metrics.retries.Load() != 1 {
		t.Fatalf("retries = %d, want 1", metrics.retries.Load())
	}
	if metrics.retriesAtLimit.Load() != 1 {
		t.Fatalf("retries at limit = %d, want 1", metrics.retriesAtLimit.Load())
	}
	if metrics.processingFailures.Load() != 1 {
		t.Fatalf("processing failures = %d, want 1", metrics.processingFailures.Load())
	}
}

func TestRunnerRecordsMalformedCommandAsProcessingFailure(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	deliveries := make(chan Delivery, 1)
	delivery := &testDelivery{
		payload: []byte("not-json"),
		onRetry: cancel,
	}
	deliveries <- delivery
	metrics := &retryMetrics{}
	handler, err := NewCommandHandler(func(context.Context, handlerCommand) error { return nil })
	if err != nil {
		t.Fatalf("NewCommandHandler() error = %v", err)
	}
	runner := Runner{
		Consumer:    testConsumer{deliveries: deliveries},
		Concurrency: 1,
		Metrics:     metrics,
		Handler:     handler,
	}

	if err := runner.Run(ctx); err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if metrics.processingFailures.Load() != 1 {
		t.Fatalf("processing failures = %d, want 1", metrics.processingFailures.Load())
	}
	if metrics.retries.Load() != 1 {
		t.Fatalf("retries = %d, want 1", metrics.retries.Load())
	}
}

type retryMetrics struct {
	retries            atomic.Int32
	retriesAtLimit     atomic.Int32
	processingFailures atomic.Int32
}

func (metrics *retryMetrics) ObserveProcessing(_ time.Duration, outcome ProcessingOutcome) {
	if outcome == ProcessingRetryableFailure {
		metrics.processingFailures.Add(1)
	}
}

func (metrics *retryMetrics) ObserveRetry(willDeadLetter bool) {
	metrics.retries.Add(1)
	if willDeadLetter {
		metrics.retriesAtLimit.Add(1)
	}
}
