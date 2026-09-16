package image

import (
	"fmt"
	"sync"

	"github.com/davidbyttow/govips/v2/vips"
)

type EngineConfig struct {
	Concurrency    int
	MaxCacheFiles  int
	MaxCacheMemory int
	MaxCacheSize   int
}

func StartEngine(cfg EngineConfig) (func(), error) {
	if cfg.Concurrency < 1 {
		return nil, fmt.Errorf("concurrency must be positive")
	}
	if cfg.MaxCacheFiles < 0 || cfg.MaxCacheMemory < 0 || cfg.MaxCacheSize < 0 {
		return nil, fmt.Errorf("cache limits must be non-negative")
	}

	if err := vips.Startup(&vips.Config{
		ConcurrencyLevel: cfg.Concurrency,
		MaxCacheFiles:    cfg.MaxCacheFiles,
		MaxCacheMem:      cfg.MaxCacheMemory,
		MaxCacheSize:     cfg.MaxCacheSize,
	}); err != nil {
		return nil, fmt.Errorf("start govips: %w", err)
	}

	var once sync.Once
	return func() {
		once.Do(vips.Shutdown)
	}, nil
}
