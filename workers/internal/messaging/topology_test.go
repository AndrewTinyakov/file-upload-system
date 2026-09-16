package messaging

import (
	"reflect"
	"testing"

	"github.com/AndrewTinyakov/file-upload-system/workers/internal/rabbitmq"
)

func TestJobTopologies(t *testing.T) {
	tests := []struct {
		name  string
		route JobRoute
		want  rabbitmq.Topology
	}{
		{name: "document", route: DocumentJobs, want: jobTopology("document.jobs", "document.prepare.v1", 7)},
		{name: "image", route: ImageJobs, want: jobTopology("image.jobs", "image.prepare.v1", 7)},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := test.route.Topology(7); !reflect.DeepEqual(got, test.want) {
				t.Fatalf("Topology() = %#v, want %#v", got, test.want)
			}
		})
	}
}

func TestEventPublisher(t *testing.T) {
	want := rabbitmq.PublisherConfig{
		Exchanges: []rabbitmq.Exchange{{Name: EventsExchange, Kind: "topic", Durable: true}},
	}
	if got := EventPublisher(); !reflect.DeepEqual(got, want) {
		t.Fatalf("EventPublisher() = %#v, want %#v", got, want)
	}
}

func jobTopology(queue, routingKey string, deliveryLimit int) rabbitmq.Topology {
	return rabbitmq.Topology{
		Exchanges: []rabbitmq.Exchange{
			{Name: CommandsExchange, Kind: "topic", Durable: true},
			{Name: DeadExchange, Kind: "topic", Durable: true},
		},
		Queue: rabbitmq.Queue{
			Name:    queue,
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
		Bindings: []rabbitmq.Binding{{Exchange: CommandsExchange, RoutingKey: routingKey}},
	}
}
