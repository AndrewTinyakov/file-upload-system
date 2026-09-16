package rabbitmq

import (
	"fmt"

	amqp "github.com/rabbitmq/amqp091-go"
)

type Exchange struct {
	Name       string
	Kind       string
	Durable    bool
	AutoDelete bool
}

type Queue struct {
	Name       string
	Durable    bool
	Exclusive  bool
	AutoDelete bool
	Arguments  map[string]any
}

type Binding struct {
	Exchange   string
	RoutingKey string
}

type Topology struct {
	Exchanges []Exchange
	Queue     Queue
	Bindings  []Binding
}

func declareTopology(channel *amqp.Channel, topology Topology) (string, error) {
	if err := validateTopology(topology); err != nil {
		return "", err
	}

	if err := declareExchanges(channel, topology.Exchanges); err != nil {
		return "", err
	}

	queue, err := channel.QueueDeclare(
		topology.Queue.Name,
		topology.Queue.Durable,
		topology.Queue.AutoDelete,
		topology.Queue.Exclusive,
		false,
		amqp.Table(topology.Queue.Arguments),
	)
	if err != nil {
		return "", fmt.Errorf("declare queue %q: %w", topology.Queue.Name, err)
	}

	for _, binding := range topology.Bindings {
		if err := channel.QueueBind(
			queue.Name,
			binding.RoutingKey,
			binding.Exchange,
			false,
			nil,
		); err != nil {
			return "", fmt.Errorf("bind queue %q: %w", queue.Name, err)
		}
	}

	return queue.Name, nil
}

func declareExchanges(channel *amqp.Channel, exchanges []Exchange) error {
	for _, exchange := range exchanges {
		if err := channel.ExchangeDeclare(
			exchange.Name,
			exchange.Kind,
			exchange.Durable,
			exchange.AutoDelete,
			false,
			false,
			nil,
		); err != nil {
			return fmt.Errorf("declare exchange %q: %w", exchange.Name, err)
		}
	}
	return nil
}

func validateTopology(topology Topology) error {
	if topology.Queue.Name == "" {
		return fmt.Errorf("queue name is required")
	}

	if err := validateExchanges(topology.Exchanges); err != nil {
		return err
	}

	exchanges := make(map[string]struct{}, len(topology.Exchanges))
	for _, exchange := range topology.Exchanges {
		exchanges[exchange.Name] = struct{}{}
	}

	for _, binding := range topology.Bindings {
		if _, ok := exchanges[binding.Exchange]; !ok {
			return fmt.Errorf("binding exchange %q is not declared", binding.Exchange)
		}
		if binding.RoutingKey == "" {
			return fmt.Errorf("binding routing key is required")
		}
	}

	return nil
}

func validateExchanges(exchanges []Exchange) error {
	for _, exchange := range exchanges {
		if exchange.Name == "" {
			return fmt.Errorf("exchange name is required")
		}
		if exchange.Kind == "" {
			return fmt.Errorf("exchange %q kind is required", exchange.Name)
		}
	}
	return nil
}
