package worker

import (
	"context"
	"errors"
	"testing"
)

type handlerCommand struct {
	CommandID string `json:"commandId"`
	AssetID   string `json:"assetId"`
}

func TestCommandHandlerDecodesAndHandlesCommand(t *testing.T) {
	var received handlerCommand
	handler, err := NewCommandHandler(func(_ context.Context, command handlerCommand) error {
		received = command
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	if err := handler.Handle(context.Background(), []byte("{\"commandId\":\"command-1\",\"assetId\":\"asset-1\"}")); err != nil {
		t.Fatal(err)
	}
	if received.CommandID != "command-1" || received.AssetID != "asset-1" {
		t.Fatalf("received = %#v", received)
	}
}

func TestCommandHandlerReturnsDecodeError(t *testing.T) {
	handler, err := NewCommandHandler(func(context.Context, handlerCommand) error { return nil })
	if err != nil {
		t.Fatal(err)
	}
	if err := handler.Handle(context.Background(), []byte("{\"commandId\":")); err == nil {
		t.Fatal("Handle() error = nil, want decode error")
	}
}

func TestCommandHandlerReturnsCommandError(t *testing.T) {
	want := errors.New("command failed")
	handler, err := NewCommandHandler(func(context.Context, handlerCommand) error { return want })
	if err != nil {
		t.Fatal(err)
	}
	err = handler.Handle(context.Background(), []byte("{\"commandId\":\"command-1\"}"))
	if !errors.Is(err, want) {
		t.Fatalf("Handle() error = %v, want %v", err, want)
	}
}

func TestNewCommandHandlerRejectsNilHandler(t *testing.T) {
	var handle CommandFunc[handlerCommand]
	if _, err := NewCommandHandler(handle); err == nil {
		t.Fatal("NewCommandHandler() error = nil, want validation error")
	}
}
