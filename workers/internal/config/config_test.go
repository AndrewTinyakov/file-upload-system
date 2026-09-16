package config

import (
	"strings"
	"testing"
)

func TestLoadImageReadsVipsResourceLimits(t *testing.T) {
	t.Setenv("VIPS_CONCURRENCY", "2")
	t.Setenv("VIPS_MAX_CACHE_FILES", "4")
	t.Setenv("VIPS_MAX_CACHE_MEMORY_MIB", "128")
	t.Setenv("VIPS_MAX_CACHE_SIZE", "50")

	cfg, err := LoadImage()
	if err != nil {
		t.Fatalf("LoadImage() error = %v", err)
	}

	want := Vips{
		Concurrency:    2,
		MaxCacheFiles:  4,
		MaxCacheMemory: 134_217_728,
		MaxCacheSize:   50,
	}
	if cfg.Vips != want {
		t.Fatalf("Vips = %+v, want %+v", cfg.Vips, want)
	}
}

func TestLoadDocumentDefaultsPrefetchToConcurrency(t *testing.T) {
	t.Setenv("WORKER_CONCURRENCY", "6")

	cfg, err := LoadDocument()
	if err != nil {
		t.Fatalf("LoadDocument() error = %v", err)
	}
	if cfg.RabbitMQ.Prefetch != 6 {
		t.Fatalf("RabbitMQ.Prefetch = %d, want 6", cfg.RabbitMQ.Prefetch)
	}
}

func TestLoadDocumentRejectsPrefetchBelowOne(t *testing.T) {
	t.Setenv("RABBITMQ_PREFETCH", "0")

	_, err := LoadDocument()
	if err == nil {
		t.Fatal("LoadDocument() error = nil, want error")
	}
	if !strings.Contains(err.Error(), "RABBITMQ_PREFETCH") {
		t.Fatalf("LoadDocument() error = %q, want it to name RABBITMQ_PREFETCH", err)
	}
}

func TestLoadImageRejectsNegativeCacheSize(t *testing.T) {
	t.Setenv("VIPS_MAX_CACHE_SIZE", "-1")

	_, err := LoadImage()
	if err == nil {
		t.Fatal("LoadImage() error = nil, want error")
	}
	if !strings.Contains(err.Error(), "VIPS_MAX_CACHE_SIZE") {
		t.Fatalf("LoadImage() error = %q, want it to name VIPS_MAX_CACHE_SIZE", err)
	}
}
