package worker

import (
	"context"
	"errors"
	"testing"

	"github.com/AndrewTinyakov/file-upload-system/workers/internal/completion"
)

func TestPublishPreparationResultPublishesCompletion(t *testing.T) {
	publisher := &preparationPublisher{}
	record := completionRecord()

	if err := PublishPreparationResult(
		context.Background(),
		publisher,
		"command-1",
		"asset-1",
		record,
		nil,
	); err != nil {
		t.Fatal(err)
	}
	if publisher.completion == nil || publisher.completion.CommandID != "command-1" {
		t.Fatalf("completion = %#v", publisher.completion)
	}
	if publisher.failureCode != "" {
		t.Fatalf("failure code = %q, want empty", publisher.failureCode)
	}
}

func TestPublishPreparationResultPublishesPermanentFailure(t *testing.T) {
	publisher := &preparationPublisher{}
	if err := PublishPreparationResult(
		context.Background(),
		publisher,
		"command-1",
		"asset-1",
		completion.Record{},
		Permanent(FailureInvalidImage, errors.New("bad image")),
	); err != nil {
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
}

func TestPublishPreparationResultReturnsTemporaryFailureWithoutPublishing(t *testing.T) {
	want := errors.New("storage unavailable")
	publisher := &preparationPublisher{}
	err := PublishPreparationResult(
		context.Background(),
		publisher,
		"command-1",
		"asset-1",
		completion.Record{},
		want,
	)
	if !errors.Is(err, want) {
		t.Fatalf("PublishPreparationResult() error = %v, want %v", err, want)
	}
	if publisher.completion != nil || publisher.failureCode != "" {
		t.Fatal("temporary failure was published")
	}
}

func TestPublishPreparationResultReturnsPublisherFailure(t *testing.T) {
	want := errors.New("confirmation timed out")
	publisher := &preparationPublisher{err: want}
	err := PublishPreparationResult(
		context.Background(),
		publisher,
		"command-1",
		"asset-1",
		completionRecord(),
		nil,
	)
	if !errors.Is(err, want) {
		t.Fatalf("PublishPreparationResult() error = %v, want %v", err, want)
	}
}

type preparationPublisher struct {
	completion  *completion.Record
	commandID   string
	assetID     string
	failureCode string
	err         error
}

func (publisher *preparationPublisher) PublishCompletion(_ context.Context, record completion.Record) error {
	publisher.completion = &record
	return publisher.err
}

func (publisher *preparationPublisher) PublishFailure(
	_ context.Context,
	commandID string,
	assetID string,
	failureCode string,
) error {
	publisher.commandID = commandID
	publisher.assetID = assetID
	publisher.failureCode = failureCode
	return publisher.err
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
