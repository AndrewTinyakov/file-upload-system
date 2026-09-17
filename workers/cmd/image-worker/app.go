package main

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/AndrewTinyakov/file-upload-system/workers/internal/config"
	generated "github.com/AndrewTinyakov/file-upload-system/workers/internal/generated/messaging"
	imageprocessor "github.com/AndrewTinyakov/file-upload-system/workers/internal/image"
	"github.com/AndrewTinyakov/file-upload-system/workers/internal/messaging"
	"github.com/AndrewTinyakov/file-upload-system/workers/internal/objectstore"
	"github.com/AndrewTinyakov/file-upload-system/workers/internal/rabbitmq"
	"github.com/AndrewTinyakov/file-upload-system/workers/internal/worker"
)

type imageApp struct {
	config         config.Image
	processor      imageprocessor.Processor
	shutdownEngine func()
	connection     *rabbitmq.Connection
	consumer       *rabbitmq.Consumer
	publisher      *messaging.EventPublisher
	runner         worker.Runner
}

func run(ctx context.Context, logger *slog.Logger) error {
	cfg, err := config.LoadImage()
	if err != nil {
		return fmt.Errorf("load configuration: %w", err)
	}

	app, err := newImageApp(ctx, cfg, logger)
	if err != nil {
		return err
	}
	defer app.close()

	app.logStarted(logger)
	return app.runner.Run(ctx)
}

func newImageApp(ctx context.Context, cfg config.Image, logger *slog.Logger) (_ *imageApp, err error) {
	app := &imageApp{config: cfg}
	defer func() {
		if err != nil {
			app.close()
		}
	}()

	app.shutdownEngine, err = imageprocessor.StartEngine(imageprocessor.EngineConfig{
		Concurrency:    cfg.Vips.Concurrency,
		MaxCacheFiles:  cfg.Vips.MaxCacheFiles,
		MaxCacheMemory: cfg.Vips.MaxCacheMemory,
		MaxCacheSize:   cfg.Vips.MaxCacheSize,
	})
	if err != nil {
		return nil, fmt.Errorf("start image engine: %w", err)
	}

	storage, err := objectstore.NewS3(ctx, cfg.Storage)
	if err != nil {
		return nil, fmt.Errorf("create object-storage client: %w", err)
	}

	app.connection, err = rabbitmq.Dial(cfg.RabbitMQ.URL)
	if err != nil {
		return nil, fmt.Errorf("open RabbitMQ connection: %w", err)
	}

	app.consumer, err = app.connection.NewConsumer(rabbitmq.ConsumerConfig{
		Topology: messaging.ImageJobs.Topology(cfg.RabbitMQ.DeliveryLimit),
		Prefetch: cfg.RabbitMQ.Prefetch,
	})
	if err != nil {
		return nil, fmt.Errorf("create image consumer: %w", err)
	}

	app.publisher, err = messaging.NewEventPublisher(app.connection)
	if err != nil {
		return nil, fmt.Errorf("create event publisher: %w", err)
	}

	app.processor = imageprocessor.NewProcessor(storage)
	handler, err := worker.NewCommandHandler(app.handlePrepareImage)
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

func (app *imageApp) handlePrepareImage(
	ctx context.Context,
	command generated.PrepareImageCommandV1,
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

func (app *imageApp) logStarted(logger *slog.Logger) {
	logger.Info(
		"image worker started",
		"queue", app.consumer.QueueName(),
		"concurrency", app.config.Concurrency,
		"prefetch", app.config.RabbitMQ.Prefetch,
	)
}

func (app *imageApp) close() {
	if app.publisher != nil {
		_ = app.publisher.Close()
	}
	if app.consumer != nil {
		_ = app.consumer.Close()
	}
	if app.connection != nil {
		_ = app.connection.Close()
	}
	if app.shutdownEngine != nil {
		app.shutdownEngine()
	}
}
