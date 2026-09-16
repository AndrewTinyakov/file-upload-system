package rabbitmq

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

type publisherReadGate struct {
	arrived chan struct{}
	release chan struct{}
	once    sync.Once
}

type publisherTestConn struct {
	net.Conn
	gate atomic.Pointer[publisherReadGate]
}

func (connection *publisherTestConn) Read(payload []byte) (int, error) {
	count, err := connection.Conn.Read(payload)
	if gate := connection.gate.Load(); gate != nil {
		gate.once.Do(func() { close(gate.arrived) })
		<-gate.release
	}
	return count, err
}

func TestPublisherRecoversAfterCancelledConfirmation(t *testing.T) {
	url := os.Getenv("RABBITMQ_TEST_URL")
	if url == "" {
		t.Skip("set RABBITMQ_TEST_URL to a RabbitMQ test broker")
	}

	for _, routingKey := range []string{"routed", "unrouted"} {
		t.Run(routingKey, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			var transport *publisherTestConn
			connection, err := DialWithConfig(url, amqp.Config{
				Dial: func(network, address string) (net.Conn, error) {
					connection, err := (&net.Dialer{}).DialContext(ctx, network, address)
					if err != nil {
						return nil, err
					}
					transport = &publisherTestConn{Conn: connection}
					return transport, nil
				},
			})
			if err != nil {
				t.Fatal(err)
			}
			defer connection.Close()

			name := fmt.Sprintf("publisher-cancellation-test-%d", time.Now().UnixNano())
			publisher, err := connection.NewPublisher(PublisherConfig{
				Exchanges: []Exchange{{Name: name, Kind: "direct"}},
			})
			if err != nil {
				t.Fatal(err)
			}
			defer publisher.Close()
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
			defer admin.ExchangeDelete(name, false, false)
			queue, err := admin.QueueDeclare("", false, true, true, false, nil)
			if err != nil {
				t.Fatal(err)
			}
			if err := admin.QueueBind(queue.Name, "routed", name, false, nil); err != nil {
				t.Fatal(err)
			}

			gate := &publisherReadGate{arrived: make(chan struct{}), release: make(chan struct{})}
			transport.gate.Store(gate)
			unblock := sync.OnceFunc(func() {
				transport.gate.Store(nil)
				close(gate.release)
			})
			defer unblock()
			firstCtx, cancelFirst := context.WithCancel(ctx)
			defer cancelFirst()
			firstResult := make(chan error, 1)
			go func() {
				firstResult <- publisher.Publish(firstCtx, Message{
					Exchange: name, RoutingKey: "unrouted", Body: []byte("first"), ContentType: "text/plain",
				})
			}()
			select {
			case <-gate.arrived:
			case <-ctx.Done():
				t.Fatal("broker did not respond to first publication")
			}
			cancelFirst()
			select {
			case err := <-firstResult:
				if !errors.Is(err, context.Canceled) {
					t.Fatalf("first Publish() = %v, want cancellation", err)
				}
			case <-ctx.Done():
				t.Fatal("first publication did not stop after cancellation")
			}
			waitingCtx, cancelWaiting := context.WithTimeout(ctx, 50*time.Millisecond)
			defer cancelWaiting()
			if err := publisher.Publish(waitingCtx, Message{
				Exchange: name, RoutingKey: "routed", Body: []byte("cancelled retry"), ContentType: "text/plain",
			}); !errors.Is(err, context.DeadlineExceeded) {
				t.Fatalf("Publish() while confirmation is pending = %v, want deadline exceeded", err)
			}
			unblock()

			retryCtx, cancelRetry := context.WithTimeout(ctx, 2*time.Second)
			defer cancelRetry()
			err = publisher.Publish(retryCtx, Message{
				Exchange: name, RoutingKey: routingKey, Body: []byte("second"), ContentType: "text/plain",
			})
			if routingKey == "routed" && err != nil {
				t.Fatalf("routed Publish() = %v, want success", err)
			}
			if routingKey == "unrouted" && (err == nil || !strings.Contains(err.Error(), "NO_ROUTE")) {
				t.Fatalf("unrouted Publish() = %v, want NO_ROUTE", err)
			}

			if err := publisher.Publish(ctx, Message{
				Exchange: name, RoutingKey: "routed", Body: []byte("third"), ContentType: "text/plain",
			}); err != nil {
				t.Fatalf("subsequent Publish() = %v, want success", err)
			}
			bodies := []string{"third"}
			if routingKey == "routed" {
				bodies = append([]string{"second"}, bodies...)
			}
			for _, body := range bodies {
				delivery, ok, err := admin.Get(queue.Name, true)
				if err != nil || !ok || string(delivery.Body) != body {
					t.Fatalf("queued message = %q, %t, %v, want %q", delivery.Body, ok, err, body)
				}
			}
		})
	}
}
