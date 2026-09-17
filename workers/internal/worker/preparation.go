package worker

import (
	"context"

	"github.com/AndrewTinyakov/file-upload-system/workers/internal/completion"
)

type PreparationPublisher interface {
	PublishCompletion(context.Context, completion.Record) error
	PublishFailure(context.Context, string, string, string) error
}

func PublishPreparationResult(
	ctx context.Context,
	publisher PreparationPublisher,
	commandID string,
	assetID string,
	record completion.Record,
	processingErr error,
) error {
	if processingErr != nil {
		failureCode, permanent := PermanentFailureCode(processingErr)
		if !permanent {
			return processingErr
		}
		return publisher.PublishFailure(ctx, commandID, assetID, failureCode)
	}
	return publisher.PublishCompletion(ctx, record)
}
