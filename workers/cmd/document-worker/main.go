package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/AndrewTinyakov/file-upload-system/workers/internal/config"
	"github.com/AndrewTinyakov/file-upload-system/workers/internal/messaging"
	"github.com/AndrewTinyakov/file-upload-system/workers/internal/objectstore"
	"github.com/AndrewTinyakov/file-upload-system/workers/internal/rabbitmq"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := run(ctx, logger); err != nil {
		logger.Error("document worker stopped", "error", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, logger *slog.Logger) error {
	cfg, err := config.LoadDocument()
	if err != nil {
		return fmt.Errorf("load configuration: %w", err)
	}

	if _, err := objectstore.NewS3(ctx, cfg.Storage); err != nil {
		return fmt.Errorf("create object-storage client: %w", err)
	}

	connection, err := rabbitmq.Dial(cfg.RabbitMQ.URL)
	if err != nil {
		return fmt.Errorf("open RabbitMQ connection: %w", err)
	}
	defer connection.Close()

	consumer, err := connection.NewConsumer(rabbitmq.ConsumerConfig{
		Topology: messaging.DocumentJobs.Topology(cfg.RabbitMQ.DeliveryLimit),
		Prefetch: cfg.RabbitMQ.Prefetch,
	})
	if err != nil {
		return fmt.Errorf("create document consumer: %w", err)
	}
	defer consumer.Close()

	logger.Info(
		"document worker base initialized",
		"queue", consumer.QueueName(),
		"concurrency", cfg.Concurrency,
		"prefetch", cfg.RabbitMQ.Prefetch,
	)
	<-ctx.Done()
	return nil
}
