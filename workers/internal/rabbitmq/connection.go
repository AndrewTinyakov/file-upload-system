package rabbitmq

import (
	"fmt"

	amqp "github.com/rabbitmq/amqp091-go"
)

type Connection struct {
	raw *amqp.Connection
}

func Dial(url string) (*Connection, error) {
	if url == "" {
		return nil, fmt.Errorf("RabbitMQ URL is required")
	}

	connection, err := amqp.Dial(url)
	if err != nil {
		return nil, fmt.Errorf("dial RabbitMQ: %w", err)
	}

	return &Connection{raw: connection}, nil
}

func DialWithConfig(url string, config amqp.Config) (*Connection, error) {
	if url == "" {
		return nil, fmt.Errorf("RabbitMQ URL is required")
	}

	connection, err := amqp.DialConfig(url, config)
	if err != nil {
		return nil, fmt.Errorf("dial RabbitMQ: %w", err)
	}

	return &Connection{raw: connection}, nil
}

func (connection *Connection) Close() error {
	return connection.raw.Close()
}
