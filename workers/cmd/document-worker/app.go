package main

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/AndrewTinyakov/file-upload-system/workers/internal/config"
	"github.com/AndrewTinyakov/file-upload-system/workers/internal/document"
	generated "github.com/AndrewTinyakov/file-upload-system/workers/internal/generated/messaging"
	"github.com/AndrewTinyakov/file-upload-system/workers/internal/messaging"
	"github.com/AndrewTinyakov/file-upload-system/workers/internal/objectstore"
	"github.com/AndrewTinyakov/file-upload-system/workers/internal/rabbitmq"
	"github.com/AndrewTinyakov/file-upload-system/workers/internal/worker"
)

type documentApp struct {
	config     config.Worker
	processor  document.Processor
	connection *rabbitmq.Connection
	consumer   *rabbitmq.Consumer
	publisher  *messaging.EventPublisher
	runner     worker.Runner
}

func run(ctx context.Context, logger *slog.Logger) error {
	cfg, err := config.LoadDocument()
	if err != nil {
		return fmt.Errorf("load configuration: %w", err)
	}

	app, err := newDocumentApp(ctx, cfg, logger)
	if err != nil {
		return err
	}
	defer app.close()

	app.logStarted(logger)
	return app.runner.Run(ctx)
}

func newDocumentApp(ctx context.Context, cfg config.Worker, logger *slog.Logger) (_ *documentApp, err error) {
	storage, err := objectstore.NewS3(ctx, cfg.Storage)
	if err != nil {
		return nil, fmt.Errorf("create object-storage client: %w", err)
	}

	app := &documentApp{config: cfg}
	defer func() {
		if err != nil {
			app.close()
		}
	}()

	app.connection, err = rabbitmq.Dial(cfg.RabbitMQ.URL)
	if err != nil {
		return nil, fmt.Errorf("open RabbitMQ connection: %w", err)
	}

	app.consumer, err = app.connection.NewConsumer(rabbitmq.ConsumerConfig{
		Topology: messaging.DocumentJobs.Topology(cfg.RabbitMQ.DeliveryLimit),
		Prefetch: cfg.RabbitMQ.Prefetch,
	})
	if err != nil {
		return nil, fmt.Errorf("create document consumer: %w", err)
	}

	app.publisher, err = messaging.NewEventPublisher(app.connection)
	if err != nil {
		return nil, fmt.Errorf("create event publisher: %w", err)
	}

	app.processor = document.NewProcessor(storage)
	handler, err := worker.NewCommandHandler(app.handlePrepareDocument)
	if err != nil {
		return nil, fmt.Errorf("create command handler: %w", err)
	}
	app.runner = worker.Runner{
		Consumer:    app.consumer,
		Handler:     handler,
		Concurrency: cfg.Concurrency,
		Logger:      logger,
	}
	return app, nil
}

func (app *documentApp) handlePrepareDocument(
	ctx context.Context,
	command generated.PrepareDocumentCommandV1,
) error {
	record, err := app.processor.Process(ctx, command)
	return worker.PublishPreparationResult(
		ctx,
		app.publisher,
		command.CommandId,
		command.AssetId,
		record,
		err,
	)
}

func (app *documentApp) logStarted(logger *slog.Logger) {
	logger.Info(
		"document worker started",
		"queue", app.consumer.QueueName(),
		"concurrency", app.config.Concurrency,
		"prefetch", app.config.RabbitMQ.Prefetch,
	)
}

func (app *documentApp) close() {
	if app.publisher != nil {
		_ = app.publisher.Close()
	}
	if app.consumer != nil {
		_ = app.consumer.Close()
	}
	if app.connection != nil {
		_ = app.connection.Close()
	}
}
