package rabbitmq

import (
	"context"
	"fmt"

	"github.com/AndrewTinyakov/file-upload-system/workers/internal/worker"
	amqp "github.com/rabbitmq/amqp091-go"
)

type ConsumerConfig struct {
	Topology Topology
	Prefetch int
}

type Consumer struct {
	channel   *amqp.Channel
	queueName string
}

func (connection *Connection) NewConsumer(cfg ConsumerConfig) (*Consumer, error) {
	if cfg.Prefetch < 1 {
		return nil, fmt.Errorf("prefetch must be positive")
	}

	channel, err := connection.raw.Channel()
	if err != nil {
		return nil, fmt.Errorf("open consumer channel: %w", err)
	}

	queueName, err := declareTopology(channel, cfg.Topology)
	if err != nil {
		_ = channel.Close()
		return nil, err
	}

	if err := channel.Qos(cfg.Prefetch, 0, false); err != nil {
		_ = channel.Close()
		return nil, fmt.Errorf("set consumer prefetch: %w", err)
	}

	return &Consumer{channel: channel, queueName: queueName}, nil
}

func (consumer *Consumer) Deliveries(ctx context.Context) (<-chan worker.Delivery, error) {
	deliveries, err := consumer.channel.ConsumeWithContext(
		ctx,
		consumer.queueName,
		"",
		false,
		false,
		false,
		false,
		nil,
	)
	if err != nil {
		return nil, fmt.Errorf("consume queue %q: %w", consumer.queueName, err)
	}

	output := make(chan worker.Delivery)
	go func() {
		defer close(output)
		for delivery := range deliveries {
			select {
			case output <- amqpDelivery{delivery: delivery}:
			case <-ctx.Done():
				return
			}
		}
	}()

	return output, nil
}

func (consumer *Consumer) QueueName() string {
	return consumer.queueName
}

func (consumer *Consumer) Close() error {
	return consumer.channel.Close()
}

type amqpDelivery struct {
	delivery amqp.Delivery
}

func (delivery amqpDelivery) Body() []byte {
	return delivery.delivery.Body
}

func (delivery amqpDelivery) Ack() error {
	return delivery.delivery.Ack(false)
}

func (delivery amqpDelivery) Retry() error {
	return delivery.delivery.Reject(true)
}
