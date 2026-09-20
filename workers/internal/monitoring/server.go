package monitoring

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"time"
)

type runResult struct {
	component string
	err       error
}

func RunWithServer(
	ctx context.Context,
	address string,
	handler http.Handler,
	workload func(context.Context) error,
) error {
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return fmt.Errorf("listen for metrics: %w", err)
	}

	runCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	server := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}
	results := make(chan runResult, 2)
	go func() {
		err := server.Serve(listener)
		if errors.Is(err, http.ErrServerClosed) {
			err = nil
		}
		results <- runResult{component: "metrics server", err: err}
	}()
	go func() {
		results <- runResult{component: "worker", err: workload(runCtx)}
	}()

	first := <-results
	cancel()
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	shutdownErr := server.Shutdown(shutdownCtx)
	shutdownCancel()
	second := <-results

	for _, result := range []runResult{first, second} {
		if result.err != nil {
			return fmt.Errorf("%s: %w", result.component, result.err)
		}
	}
	if shutdownErr != nil {
		return fmt.Errorf("stop metrics server: %w", shutdownErr)
	}
	return nil
}
