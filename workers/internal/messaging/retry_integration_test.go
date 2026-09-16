package messaging

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/AndrewTinyakov/file-upload-system/workers/internal/rabbitmq"
	amqp "github.com/rabbitmq/amqp091-go"
)

func TestFailedJobsBackOffAndDeadLetter(t *testing.T) {
	for _, lateBinding := range []bool{false, true} {
		t.Run(fmt.Sprintf("late-binding=%t", lateBinding), func(t *testing.T) {
			testFailedJobsBackOffAndDeadLetter(t, lateBinding)
		})
	}
}

func testFailedJobsBackOffAndDeadLetter(t *testing.T, lateBinding bool) {
	url := os.Getenv("RABBITMQ_TEST_URL")
	if url == "" {
		t.Skip("set RABBITMQ_TEST_URL to a RabbitMQ 4.3 test broker")
	}
	timeout := 20 * time.Second
	if lateBinding {
		timeout = 4 * time.Minute
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	connection, err := rabbitmq.Dial(url)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	name := fmt.Sprintf("retry-test-%d", time.Now().UnixNano())
	route := JobRoute{Queue: name, RoutingKey: name}
	consumer, err := connection.NewConsumer(rabbitmq.ConsumerConfig{
		Topology: route.Topology(2),
		Prefetch: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer consumer.Close()

	admin, err := amqp.Dial(url)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	channel, err := admin.Channel()
	if err != nil {
		t.Fatal(err)
	}
	defer channel.Close()
	defer channel.QueueDelete(name, false, false, false)
	deadQueue, err := channel.QueueDeclare("", false, true, true, false, nil)
	if err != nil {
		t.Fatal(err)
	}
	bindDeadQueue := func() {
		t.Helper()
		if err := channel.QueueBind(deadQueue.Name, name, DeadExchange, false, nil); err != nil {
			t.Fatal(err)
		}
	}
	if !lateBinding {
		bindDeadQueue()
	}
	deadLetters, err := channel.ConsumeWithContext(ctx, deadQueue.Name, "", true, false, false, false, nil)
	if err != nil {
		t.Fatal(err)
	}
	deliveries, err := consumer.Deliveries(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := channel.PublishWithContext(ctx, CommandsExchange, name, true, false, amqp.Publishing{
		Body: []byte("retry regression"),
	}); err != nil {
		t.Fatal(err)
	}

	attempts := 0
	var rejectedAt time.Time
	var bindAfter <-chan time.Time
	for {
		select {
		case <-ctx.Done():
			t.Fatalf("job was not dead-lettered after %d attempts: %v", attempts, ctx.Err())
		case <-bindAfter:
			bindDeadQueue()
			bindAfter = nil
		case delivery, ok := <-deliveries:
			if !ok {
				t.Fatal("delivery stream closed")
			}
			if attempts > 0 {
				minimum := time.Duration(attempts)*time.Second - 100*time.Millisecond
				if elapsed := time.Since(rejectedAt); elapsed < minimum {
					t.Fatalf("retry %d arrived after %s, want at least %s", attempts, elapsed, minimum)
				}
			}
			attempts++
			if attempts > 3 {
				t.Fatal("job exceeded delivery limit without dead-lettering")
			}
			rejectedAt = time.Now()
			if err := delivery.Retry(); err != nil {
				t.Fatal(err)
			}
			if lateBinding && attempts == 3 {
				timer := time.NewTimer(time.Second)
				defer timer.Stop()
				bindAfter = timer.C
			}
		case dead, ok := <-deadLetters:
			if !ok {
				t.Fatal("dead-letter stream closed")
			}
			if attempts != 3 || string(dead.Body) != "retry regression" {
				t.Fatalf("dead letter after %d attempts with body %q, want 3 attempts and original body", attempts, dead.Body)
			}
			return
		}
	}
}
