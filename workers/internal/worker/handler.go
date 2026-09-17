package worker

import (
	"context"
	"fmt"

	"github.com/AndrewTinyakov/file-upload-system/workers/internal/messagecodec"
)

type CommandFunc[C any] func(context.Context, C) error

type CommandHandler[C any] struct {
	handle CommandFunc[C]
}

func NewCommandHandler[C any](handle CommandFunc[C]) (*CommandHandler[C], error) {
	if handle == nil {
		return nil, fmt.Errorf("command handler is required")
	}
	return &CommandHandler[C]{handle: handle}, nil
}

func (handler *CommandHandler[C]) Handle(ctx context.Context, payload []byte) error {
	command, err := messagecodec.Decode[C](payload)
	if err != nil {
		return fmt.Errorf("decode command: %w", err)
	}

	return handler.handle(ctx, command)
}
