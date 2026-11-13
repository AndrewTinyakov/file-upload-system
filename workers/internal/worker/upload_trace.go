package worker

import (
	"log/slog"
	"strings"
	"time"
)

const uploadTraceAlphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

func uploadTraceSampled(assetID string) bool {
	if len(assetID) < 2 {
		return false
	}
	suffix := 32*strings.IndexByte(uploadTraceAlphabet, assetID[len(assetID)-2]) +
		strings.IndexByte(uploadTraceAlphabet, assetID[len(assetID)-1])
	return suffix%100 == 0
}

func traceConfirmedPreparationResult(
	message PreparationMetadata,
	timing PreparationTiming,
	outcome ProcessingOutcome,
	now func() time.Time,
) {
	if !uploadTraceSampled(message.AssetID) {
		return
	}
	slog.Info(
		"upload_trace",
		"asset_id", message.AssetID,
		"command_id", message.CommandID,
		"stage", "worker_result_confirmed",
		"preparation_started_at", timing.PreparationStartedAt(),
		"worker_started_at", timing.WorkerStartedAt(),
		"worker_finished_at", timing.WorkerFinishedAt(),
		"result_confirmed_at", now(),
		"outcome", outcome,
	)
}
