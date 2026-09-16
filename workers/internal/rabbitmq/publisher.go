package rabbitmq

import (
	"context"
	"fmt"
	"sync"

	amqp "github.com/rabbitmq/amqp091-go"
)

type PublisherConfig struct {
	Exchanges []Exchange
}

type Message struct {
	Exchange    string
	RoutingKey  string
	Body        []byte
	ContentType string
}

type Publisher struct {
	channel  *amqp.Channel
	returned <-chan amqp.Return
	pending  *amqp.DeferredConfirmation
	mutex    sync.Mutex
}

func (connection *Connection) NewPublisher(cfg PublisherConfig) (*Publisher, error) {
	if len(cfg.Exchanges) == 0 {
		return nil, fmt.Errorf("at least one exchange is required")
	}
	if err := validateExchanges(cfg.Exchanges); err != nil {
		return nil, err
	}

	channel, err := connection.raw.Channel()
	if err != nil {
		return nil, fmt.Errorf("open publisher channel: %w", err)
	}

	if err := declareExchanges(channel, cfg.Exchanges); err != nil {
		_ = channel.Close()
		return nil, err
	}

	if err := channel.Confirm(false); err != nil {
		_ = channel.Close()
		return nil, fmt.Errorf("enable publisher confirms: %w", err)
	}

	returned := channel.NotifyReturn(make(chan amqp.Return, 1))
	return &Publisher{channel: channel, returned: returned}, nil
}

func (publisher *Publisher) Publish(ctx context.Context, message Message) error {
	if message.Exchange == "" {
		return fmt.Errorf("exchange is required")
	}
	if message.RoutingKey == "" {
		return fmt.Errorf("routing key is required")
	}
	if message.ContentType == "" {
		return fmt.Errorf("content type is required")
	}

	publisher.mutex.Lock()
	defer publisher.mutex.Unlock()

	if publisher.pending != nil {
		if _, err := publisher.pending.WaitContext(ctx); err != nil {
			return fmt.Errorf("wait for previous publisher confirm: %w", err)
		}
		select {
		case <-publisher.returned:
		default:
		}
		publisher.pending = nil
	}

	confirmation, err := publisher.channel.PublishWithDeferredConfirmWithContext(
		ctx,
		message.Exchange,
		message.RoutingKey,
		true,
		false,
		amqp.Publishing{
			DeliveryMode: amqp.Persistent,
			ContentType:  message.ContentType,
			Body:         message.Body,
		},
	)
	if err != nil {
		return fmt.Errorf("publish to %q with %q: %w", message.Exchange, message.RoutingKey, err)
	}

	publisher.pending = confirmation
	acknowledged, err := confirmation.WaitContext(ctx)
	if err != nil {
		return fmt.Errorf("wait for publisher confirm: %w", err)
	}
	publisher.pending = nil

	select {
	case returned, ok := <-publisher.returned:
		if ok {
			return fmt.Errorf("message was not routed: %s", returned.ReplyText)
		}
	default:
	}
	if !acknowledged {
		return fmt.Errorf("broker rejected publication")
	}
	return nil
}

func (publisher *Publisher) Close() error {
	return publisher.channel.Close()
}
