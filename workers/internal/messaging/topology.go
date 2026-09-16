package messaging

import "github.com/AndrewTinyakov/file-upload-system/workers/internal/rabbitmq"

const (
	CommandsExchange               = "asset.commands"
	EventsExchange                 = "asset.events"
	DeadExchange                   = "asset.dead"
	PreparationCompletedRoutingKey = "asset.preparation.completed.v1"
	PreparationFailedRoutingKey    = "asset.preparation.failed.v1"
)

type JobRoute struct {
	Queue      string
	RoutingKey string
}

var (
	DocumentJobs = JobRoute{Queue: "document.jobs", RoutingKey: "document.prepare.v1"}
	ImageJobs    = JobRoute{Queue: "image.jobs", RoutingKey: "image.prepare.v1"}
)

func EventPublisher() rabbitmq.PublisherConfig {
	return rabbitmq.PublisherConfig{
		Exchanges: []rabbitmq.Exchange{
			{Name: EventsExchange, Kind: "topic", Durable: true},
		},
	}
}

func (route JobRoute) Topology(deliveryLimit int) rabbitmq.Topology {
	return rabbitmq.Topology{
		Exchanges: []rabbitmq.Exchange{
			{Name: CommandsExchange, Kind: "topic", Durable: true},
			{Name: DeadExchange, Kind: "topic", Durable: true},
		},
		Queue: rabbitmq.Queue{
			Name:    route.Queue,
			Durable: true,
			Arguments: map[string]any{
				"x-queue-type":           "quorum",
				"x-delivery-limit":       int32(deliveryLimit),
				"x-dead-letter-exchange": DeadExchange,
				"x-dead-letter-strategy": "at-least-once",
				"x-overflow":             "reject-publish",
				"x-delayed-retry-type":   "failed",
				"x-delayed-retry-min":    int32(1000),
				"x-delayed-retry-max":    int32(30000),
			},
		},
		Bindings: []rabbitmq.Binding{
			{Exchange: CommandsExchange, RoutingKey: route.RoutingKey},
		},
	}
}
