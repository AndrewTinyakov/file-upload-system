package rabbitmq

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/AndrewTinyakov/file-upload-system/workers/internal/worker"
	amqp "github.com/rabbitmq/amqp091-go"
)

func TestStaleDeliveriesCannotAcknowledgeNewChannel(t *testing.T) {
	url := os.Getenv("RABBITMQ_TEST_URL")
	if url == "" {
		t.Skip("set RABBITMQ_TEST_URL to a RabbitMQ test broker")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	connection, err := Dial(url)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	adminConnection, err := amqp.Dial(url)
	if err != nil {
		t.Fatal(err)
	}
	defer adminConnection.Close()
	admin, err := adminConnection.Channel()
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	name := fmt.Sprintf("stale-delivery-test-%d", time.Now().UnixNano())
	cfg := ConsumerConfig{Topology: Topology{Queue: Queue{Name: name, Durable: true}}, Prefetch: 1}
	consumer, err := connection.NewConsumer(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.QueueDelete(name, false, false, false)
	deliveries, err := consumer.Deliveries(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := admin.PublishWithContext(ctx, "", name, false, false, amqp.Publishing{Body: []byte("pending")}); err != nil {
		t.Fatal(err)
	}
	receive := func(deliveries <-chan worker.Delivery) worker.Delivery {
		t.Helper()
		select {
		case delivery, ok := <-deliveries:
			if !ok {
				t.Fatal("delivery stream closed")
			}
			return delivery
		case <-ctx.Done():
			t.Fatal(ctx.Err())
			return nil
		}
	}
	stale := receive(deliveries)
	if err := consumer.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case _, ok := <-deliveries:
		if ok {
			t.Fatal("closed consumer kept its delivery stream open")
		}
	case <-ctx.Done():
		t.Fatal("closed consumer did not close its delivery stream")
	}
	replacement, err := connection.NewConsumer(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer replacement.Close()
	deliveries, err = replacement.Deliveries(ctx)
	if err != nil {
		t.Fatal(err)
	}
	current := receive(deliveries)
	if string(current.Body()) != "pending" {
		t.Fatalf("redelivery = %q, want pending", current.Body())
	}
	if err := stale.Ack(); !errors.Is(err, amqp.ErrClosed) {
		t.Fatalf("stale Ack() = %v, want closed channel", err)
	}
	if err := stale.Retry(); !errors.Is(err, amqp.ErrClosed) {
		t.Fatalf("stale Retry() = %v, want closed channel", err)
	}
	if err := replacement.Close(); err != nil {
		t.Fatal(err)
	}
	remaining, ok, err := admin.Get(name, true)
	if err != nil || !ok || string(remaining.Body) != "pending" {
		t.Fatalf("unprocessed message = %q, %t, %v, want pending", remaining.Body, ok, err)
	}
}

func TestNewConsumerRejectsUnknownBindingExchange(t *testing.T) {
	url := os.Getenv("RABBITMQ_TEST_URL")
	if url == "" {
		t.Skip("set RABBITMQ_TEST_URL to a RabbitMQ test broker")
	}

	connection, err := Dial(url)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()

	_, err = connection.NewConsumer(ConsumerConfig{
		Topology: Topology{
			Queue:    Queue{Name: "invalid-topology", Durable: true},
			Bindings: []Binding{{Exchange: "asset.commands", RoutingKey: "document.prepare.v1"}},
		},
		Prefetch: 1,
	})
	if err == nil {
		t.Fatal("NewConsumer() error = nil, want error")
	}
	if !strings.Contains(err.Error(), "binding exchange") {
		t.Fatalf("NewConsumer() error = %q, want unknown binding exchange error", err)
	}
}
