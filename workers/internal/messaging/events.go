package messaging

import (
	"context"
	"fmt"

	"github.com/AndrewTinyakov/file-upload-system/workers/internal/completion"
	generated "github.com/AndrewTinyakov/file-upload-system/workers/internal/generated/messaging"
	"github.com/AndrewTinyakov/file-upload-system/workers/internal/messagecodec"
	"github.com/AndrewTinyakov/file-upload-system/workers/internal/rabbitmq"
)

type EventPublisher struct {
	publisher *rabbitmq.Publisher
}

func NewEventPublisher(connection *rabbitmq.Connection) (*EventPublisher, error) {
	publisher, err := connection.NewPublisher(eventPublisherConfig())
	if err != nil {
		return nil, err
	}
	return &EventPublisher{publisher: publisher}, nil
}

func (publisher *EventPublisher) PublishCompletion(ctx context.Context, record completion.Record) error {
	event, err := completion.CompletedEvent(record)
	if err != nil {
		return fmt.Errorf("build completion event: %w", err)
	}
	return publisher.publish(ctx, PreparationCompletedRoutingKey, event)
}

func (publisher *EventPublisher) PublishFailure(
	ctx context.Context,
	commandID string,
	assetID string,
	failureCode string,
) error {
	return publisher.publish(ctx, PreparationFailedRoutingKey, generated.AssetPreparationFailedEventV1{
		CommandId:   commandID,
		AssetId:     assetID,
		FailureCode: failureCode,
	})
}

func (publisher *EventPublisher) publish(ctx context.Context, routingKey string, event any) error {
	payload, err := messagecodec.Encode(event)
	if err != nil {
		return fmt.Errorf("encode event: %w", err)
	}
	if err := publisher.publisher.Publish(ctx, rabbitmq.Message{
		Exchange:    EventsExchange,
		RoutingKey:  routingKey,
		Body:        payload,
		ContentType: "application/json",
	}); err != nil {
		return fmt.Errorf("publish event: %w", err)
	}
	return nil
}

func (publisher *EventPublisher) Close() error {
	return publisher.publisher.Close()
}

func eventPublisherConfig() rabbitmq.PublisherConfig {
	return rabbitmq.PublisherConfig{
		Exchanges: []rabbitmq.Exchange{
			{Name: EventsExchange, Kind: "topic", Durable: true},
		},
	}
}
