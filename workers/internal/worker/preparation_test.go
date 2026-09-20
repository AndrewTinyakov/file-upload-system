package worker

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/AndrewTinyakov/file-upload-system/workers/internal/completion"
)

func TestPreparationCommandHandlerPublishesCompletionAndRecordsSuccess(t *testing.T) {
	publisher := &preparationPublisher{}
	metrics := &processingMetrics{}
	record := completionRecord()
	handler := testPreparationCommandHandler(
		t,
		func(context.Context, preparationCommand) (completion.Record, error) { return record, nil },
		publisher,
		metrics,
		workerTimes(),
	)

	if err := handler.Handle(context.Background(), preparationPayload()); err != nil {
		t.Fatal(err)
	}
	if publisher.completion == nil || publisher.completion.CommandID != "command-1" {
		t.Fatalf("completion = %#v", publisher.completion)
	}
	if got := publisher.timing.PreparationStartedAt(); !got.Equal(preparationStart()) {
		t.Fatalf("preparation start = %v, want %v", got, preparationStart())
	}
	assertProcessingMetric(t, metrics, time.Second, ProcessingSucceeded)
}

func TestPreparationCommandHandlerPublishesPermanentFailureAndRecordsIt(t *testing.T) {
	publisher := &preparationPublisher{}
	metrics := &processingMetrics{}
	handler := testPreparationCommandHandler(
		t,
		func(context.Context, preparationCommand) (completion.Record, error) {
			return completion.Record{}, Permanent(FailureInvalidImage, errors.New("bad image"))
		},
		publisher,
		metrics,
		workerTimes(),
	)

	if err := handler.Handle(context.Background(), preparationPayload()); err != nil {
		t.Fatal(err)
	}
	if publisher.commandID != "command-1" ||
		publisher.assetID != "asset-1" ||
		publisher.failureCode != FailureInvalidImage {
		t.Fatalf(
			"failure = (%q, %q, %q)",
			publisher.commandID,
			publisher.assetID,
			publisher.failureCode,
		)
	}
	if publisher.completion != nil {
		t.Fatalf("completion = %#v, want nil", publisher.completion)
	}
	assertProcessingMetric(t, metrics, time.Second, ProcessingPermanentFailure)
}

func TestPreparationCommandHandlerReturnsTemporaryFailureWithoutPublishing(t *testing.T) {
	want := errors.New("storage unavailable")
	publisher := &preparationPublisher{}
	metrics := &processingMetrics{}
	handler := testPreparationCommandHandler(
		t,
		func(context.Context, preparationCommand) (completion.Record, error) {
			return completion.Record{}, want
		},
		publisher,
		metrics,
		workerTimes(),
	)

	err := handler.Handle(context.Background(), preparationPayload())
	if !errors.Is(err, want) {
		t.Fatalf("Handle() error = %v, want %v", err, want)
	}
	if publisher.completion != nil || publisher.failureCode != "" {
		t.Fatal("temporary failure was published")
	}
	if len(metrics.observations) != 0 {
		t.Fatalf("processing metrics = %#v, want none", metrics.observations)
	}
}

func TestPreparationCommandHandlerReturnsPublisherFailure(t *testing.T) {
	want := errors.New("confirmation timed out")
	publisher := &preparationPublisher{err: want}
	metrics := &processingMetrics{}
	handler := testPreparationCommandHandler(
		t,
		func(context.Context, preparationCommand) (completion.Record, error) {
			return completionRecord(), nil
		},
		publisher,
		metrics,
		workerTimes(),
	)

	err := handler.Handle(context.Background(), preparationPayload())
	if !errors.Is(err, want) {
		t.Fatalf("Handle() error = %v, want %v", err, want)
	}
	if len(metrics.observations) != 0 {
		t.Fatalf("processing metrics = %#v, want none", metrics.observations)
	}
}

func TestPreparationCommandHandlerRejectsInvalidPreparationTimestampBeforeProcessing(t *testing.T) {
	processed := false
	publisher := &preparationPublisher{}
	metrics := &processingMetrics{}
	handler := testPreparationCommandHandler(
		t,
		func(context.Context, preparationCommand) (completion.Record, error) {
			processed = true
			return completionRecord(), nil
		},
		publisher,
		metrics,
		workerTimes(),
	)

	err := handler.Handle(
		context.Background(),
		[]byte(`{"commandId":"command-1","assetId":"asset-1","preparationStartedAt":"not-a-time"}`),
	)
	if err == nil || !strings.Contains(err.Error(), "parse preparation start time") {
		t.Fatalf("Handle() error = %v, want invalid timestamp", err)
	}
	if processed {
		t.Fatal("invalid timestamp reached the processor")
	}
}

func TestPreparationCommandHandlerRejectsReversedWorkerTimes(t *testing.T) {
	workerStartedAt := time.Date(2026, 9, 20, 10, 0, 2, 0, time.UTC)
	workerFinishedAt := workerStartedAt.Add(-time.Second)
	handler := testPreparationCommandHandler(
		t,
		func(context.Context, preparationCommand) (completion.Record, error) {
			return completionRecord(), nil
		},
		&preparationPublisher{},
		&processingMetrics{},
		[]time.Time{workerStartedAt, workerFinishedAt},
	)

	err := handler.Handle(context.Background(), preparationPayload())
	if err == nil || !strings.Contains(err.Error(), "worker finish time precedes start time") {
		t.Fatalf("Handle() error = %v, want reversed timing error", err)
	}
}

type preparationCommand struct {
	CommandID            string `json:"commandId"`
	AssetID              string `json:"assetId"`
	PreparationStartedAt string `json:"preparationStartedAt"`
}

func testPreparationCommandHandler(
	t *testing.T,
	process func(context.Context, preparationCommand) (completion.Record, error),
	publisher PreparationPublisher,
	metrics ProcessingMetrics,
	times []time.Time,
) *CommandHandler[preparationCommand] {
	t.Helper()
	nextTime := 0
	handler, err := newPreparationCommandHandler(
		process,
		func(command preparationCommand) PreparationMetadata {
			return PreparationMetadata{
				CommandID:            command.CommandID,
				AssetID:              command.AssetID,
				PreparationStartedAt: command.PreparationStartedAt,
			}
		},
		publisher,
		metrics,
		func() time.Time {
			value := times[nextTime]
			nextTime++
			return value
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	return handler
}

type preparationPublisher struct {
	completion  *completion.Record
	commandID   string
	assetID     string
	failureCode string
	timing      PreparationTiming
	err         error
}

func (publisher *preparationPublisher) PublishCompletion(
	_ context.Context,
	record completion.Record,
	timing PreparationTiming,
) error {
	publisher.completion = &record
	publisher.timing = timing
	return publisher.err
}

func (publisher *preparationPublisher) PublishFailure(
	_ context.Context,
	commandID string,
	assetID string,
	failureCode string,
	timing PreparationTiming,
) error {
	publisher.commandID = commandID
	publisher.assetID = assetID
	publisher.failureCode = failureCode
	publisher.timing = timing
	return publisher.err
}

type processingObservation struct {
	duration time.Duration
	outcome  ProcessingOutcome
}

type processingMetrics struct {
	observations []processingObservation
}

func (metrics *processingMetrics) ObserveProcessing(duration time.Duration, outcome ProcessingOutcome) {
	metrics.observations = append(metrics.observations, processingObservation{duration: duration, outcome: outcome})
}

func assertProcessingMetric(
	t *testing.T,
	metrics *processingMetrics,
	duration time.Duration,
	outcome ProcessingOutcome,
) {
	t.Helper()
	if len(metrics.observations) != 1 {
		t.Fatalf("processing metrics = %#v, want one observation", metrics.observations)
	}
	if got := metrics.observations[0]; got.duration != duration || got.outcome != outcome {
		t.Fatalf("processing metric = %#v, want duration %v and outcome %q", got, duration, outcome)
	}
}

func preparationPayload() []byte {
	return []byte(`{"commandId":"command-1","assetId":"asset-1","preparationStartedAt":"2026-09-20T10:00:00Z"}`)
}

func preparationStart() time.Time {
	return time.Date(2026, 9, 20, 10, 0, 0, 0, time.UTC)
}

func workerTimes() []time.Time {
	return []time.Time{
		time.Date(2026, 9, 20, 10, 0, 1, 0, time.UTC),
		time.Date(2026, 9, 20, 10, 0, 2, 0, time.UTC),
	}
}

func completionRecord() completion.Record {
	return completion.Record{
		CommandID: "command-1",
		AssetID:   "asset-1",
		Variants: []completion.Variant{{
			Type: "ORIGINAL", Bucket: "assets", ObjectKey: "assets/asset-1/original",
			ContentType: "application/pdf", ByteSize: 10,
		}},
	}
}
