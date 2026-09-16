package worker

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
)

type Delivery interface {
	Body() []byte
	Ack() error
	Retry() error
}

type Consumer interface {
	Deliveries(context.Context) (<-chan Delivery, error)
}

type Handler interface {
	Handle(context.Context, []byte) error
}

type HandlerFunc func(context.Context, []byte) error

func (handler HandlerFunc) Handle(ctx context.Context, payload []byte) error {
	return handler(ctx, payload)
}

type Runner struct {
	Consumer    Consumer
	Handler     Handler
	Concurrency int
	Logger      *slog.Logger
}

func (runner Runner) Run(ctx context.Context) error {
	if err := runner.validate(); err != nil {
		return err
	}

	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	deliveries, err := runner.Consumer.Deliveries(ctx)
	if err != nil {
		return fmt.Errorf("start consumer: %w", err)
	}

	return runner.runWorkers(ctx, deliveries, cancel)
}

func (runner Runner) validate() error {
	if runner.Consumer == nil {
		return fmt.Errorf("consumer is required")
	}
	if runner.Handler == nil {
		return fmt.Errorf("handler is required")
	}
	if runner.Concurrency < 1 {
		return fmt.Errorf("concurrency must be positive")
	}
	return nil
}

func (runner Runner) runWorkers(ctx context.Context, deliveries <-chan Delivery, cancel context.CancelFunc) error {
	errors := make(chan error, 1)
	report := newErrorReporter(errors, cancel)
	worker := deliveryWorker{
		deliveries: deliveries,
		handler:    runner.Handler,
		logger:     runner.logger(),
		report:     report,
	}

	var workers sync.WaitGroup
	for range runner.Concurrency {
		workers.Go(func() {
			worker.run(ctx)
		})
	}

	return waitForWorkers(ctx, &workers, errors)
}

func (runner Runner) logger() *slog.Logger {
	if runner.Logger != nil {
		return runner.Logger
	}
	return slog.Default()
}

func newErrorReporter(errors chan<- error, cancel context.CancelFunc) func(error) {
	var once sync.Once
	return func(err error) {
		once.Do(func() {
			errors <- err
			cancel()
		})
	}
}

func waitForWorkers(ctx context.Context, workers *sync.WaitGroup, errors <-chan error) error {
	done := make(chan struct{})
	go func() {
		workers.Wait()
		close(done)
	}()

	select {
	case <-ctx.Done():
		<-done
		select {
		case err := <-errors:
			return err
		default:
			return nil
		}
	case err := <-errors:
		<-done
		return err
	case <-done:
		select {
		case err := <-errors:
			return err
		default:
			return nil
		}
	}
}

type deliveryWorker struct {
	deliveries <-chan Delivery
	handler    Handler
	logger     *slog.Logger
	report     func(error)
}

func (worker deliveryWorker) run(ctx context.Context) {
	for {
		delivery, ok := worker.nextDelivery(ctx)
		if !ok || !worker.handle(ctx, delivery) {
			return
		}
	}
}

func (worker deliveryWorker) nextDelivery(ctx context.Context) (Delivery, bool) {
	select {
	case <-ctx.Done():
		return nil, false
	case delivery, ok := <-worker.deliveries:
		if !ok && ctx.Err() == nil {
			worker.report(fmt.Errorf("delivery stream closed"))
		}
		return delivery, ok
	}
}

func (worker deliveryWorker) handle(ctx context.Context, delivery Delivery) bool {
	if err := worker.handler.Handle(ctx, delivery.Body()); err != nil {
		worker.logger.Error("job failed", "error", err)
		if retryErr := delivery.Retry(); retryErr != nil {
			worker.report(fmt.Errorf("retry delivery: %w", retryErr))
			return false
		}
		return true
	}

	if err := delivery.Ack(); err != nil {
		worker.report(fmt.Errorf("acknowledge delivery: %w", err))
		return false
	}

	return true
}
