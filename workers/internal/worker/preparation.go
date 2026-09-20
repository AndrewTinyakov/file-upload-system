package worker

import (
	"context"
	"fmt"
	"time"

	"github.com/AndrewTinyakov/file-upload-system/workers/internal/completion"
)

type PreparationPublisher interface {
	PublishCompletion(context.Context, completion.Record, PreparationTiming) error
	PublishFailure(context.Context, string, string, string, PreparationTiming) error
}

type PreparationMetadata struct {
	CommandID            string
	AssetID              string
	PreparationStartedAt string
}

type PreparationTiming struct {
	preparationStartedAt time.Time
	workerStartedAt      time.Time
	workerFinishedAt     time.Time
}

func (timing PreparationTiming) PreparationStartedAt() time.Time {
	return timing.preparationStartedAt
}

func (timing PreparationTiming) WorkerStartedAt() time.Time {
	return timing.workerStartedAt
}

func (timing PreparationTiming) WorkerFinishedAt() time.Time {
	return timing.workerFinishedAt
}

func (timing PreparationTiming) ProcessingDuration() time.Duration {
	return timing.workerFinishedAt.Sub(timing.workerStartedAt)
}

type preparationTimer struct {
	preparationStartedAt time.Time
	workerStartedAt      time.Time
}

func startPreparationTiming(rawPreparationStartedAt string, workerStartedAt time.Time) (preparationTimer, error) {
	preparationStartedAt, err := time.Parse(time.RFC3339Nano, rawPreparationStartedAt)
	if err != nil {
		return preparationTimer{}, fmt.Errorf("parse preparation start time: %w", err)
	}
	if workerStartedAt.IsZero() {
		return preparationTimer{}, fmt.Errorf("worker start time is required")
	}
	return preparationTimer{
		preparationStartedAt: preparationStartedAt,
		workerStartedAt:      workerStartedAt,
	}, nil
}

func (timer preparationTimer) finish(workerFinishedAt time.Time) (PreparationTiming, error) {
	if workerFinishedAt.IsZero() {
		return PreparationTiming{}, fmt.Errorf("worker finish time is required")
	}
	if workerFinishedAt.Before(timer.workerStartedAt) {
		return PreparationTiming{}, fmt.Errorf("worker finish time precedes start time")
	}
	return PreparationTiming{
		preparationStartedAt: timer.preparationStartedAt,
		workerStartedAt:      timer.workerStartedAt,
		workerFinishedAt:     workerFinishedAt,
	}, nil
}

func NewPreparationCommandHandler[C any](
	process func(context.Context, C) (completion.Record, error),
	metadata func(C) PreparationMetadata,
	publisher PreparationPublisher,
	metrics ProcessingMetrics,
) (*CommandHandler[C], error) {
	return newPreparationCommandHandler(process, metadata, publisher, metrics, time.Now)
}

func newPreparationCommandHandler[C any](
	process func(context.Context, C) (completion.Record, error),
	metadata func(C) PreparationMetadata,
	publisher PreparationPublisher,
	metrics ProcessingMetrics,
	now func() time.Time,
) (*CommandHandler[C], error) {
	if process == nil {
		return nil, fmt.Errorf("preparation processor is required")
	}
	if metadata == nil {
		return nil, fmt.Errorf("preparation metadata adapter is required")
	}
	if publisher == nil {
		return nil, fmt.Errorf("preparation publisher is required")
	}
	if metrics == nil {
		return nil, fmt.Errorf("processing metrics are required")
	}
	if now == nil {
		return nil, fmt.Errorf("clock is required")
	}

	handle := func(ctx context.Context, command C) error {
		message := metadata(command)
		timer, err := startPreparationTiming(message.PreparationStartedAt, now())
		if err != nil {
			return err
		}
		record, processingErr := process(ctx, command)
		timing, err := timer.finish(now())
		if err != nil {
			return err
		}
		if err := publishPreparationResult(
			ctx,
			publisher,
			message,
			timing,
			record,
			processingErr,
		); err != nil {
			return err
		}
		outcome := ProcessingSucceeded
		if processingErr != nil {
			outcome = ProcessingPermanentFailure
		}
		metrics.ObserveProcessing(timing.ProcessingDuration(), outcome)
		return nil
	}
	return NewCommandHandler(handle)
}

func publishPreparationResult(
	ctx context.Context,
	publisher PreparationPublisher,
	metadata PreparationMetadata,
	timing PreparationTiming,
	record completion.Record,
	processingErr error,
) error {
	if processingErr != nil {
		failureCode, permanent := PermanentFailureCode(processingErr)
		if !permanent {
			return processingErr
		}
		return publisher.PublishFailure(
			ctx,
			metadata.CommandID,
			metadata.AssetID,
			failureCode,
			timing,
		)
	}
	return publisher.PublishCompletion(ctx, record, timing)
}
