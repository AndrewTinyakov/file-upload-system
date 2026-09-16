package worker

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
)

type testConsumer struct {
	deliveries <-chan Delivery
}

func (consumer testConsumer) Deliveries(context.Context) (<-chan Delivery, error) {
	return consumer.deliveries, nil
}

type testDelivery struct {
	payload []byte
	acked   atomic.Bool
	retried atomic.Bool
}

func (delivery *testDelivery) Body() []byte {
	return delivery.payload
}

func (delivery *testDelivery) Ack() error {
	delivery.acked.Store(true)
	return nil
}

func (delivery *testDelivery) Retry() error {
	delivery.retried.Store(true)
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
