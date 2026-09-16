# Workers

Go workers for document and image preparation. They consume jobs from RabbitMQ
and use S3-compatible storage.

## Run

From the repository root:

```shell
go -C workers run ./cmd/document-worker
go -C workers run ./cmd/image-worker
```

The image worker requires libvips and `pkg-config`:

```shell
brew install vips pkg-config
```

## Test and build

```shell
go -C workers test ./...
go -C workers build ./cmd/document-worker
go -C workers build ./cmd/image-worker
```

Generate Go message models from the repository root with:

```shell
npm run generate:asyncapi:go
```

Do not edit `internal/generated/messaging` by hand.

## Configuration

The defaults match `compose.local.yaml`:

| Variable | Default |
| --- | --- |
| `RABBITMQ_URL` | `amqp://file_upload:file_upload@localhost:5672/file_upload` |
| `WORKER_CONCURRENCY` | `4` |
| `RABBITMQ_PREFETCH` | `WORKER_CONCURRENCY` |
| `RABBITMQ_DELIVERY_LIMIT` | `5` |
| `S3_ENDPOINT` | `http://localhost:9000` |
| `S3_REGION` | `us-east-1` |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | `file_upload` |
| `S3_PATH_STYLE` | `true` |
| `VIPS_CONCURRENCY` | `1` |
| `VIPS_MAX_CACHE_FILES` | `0` |
| `VIPS_MAX_CACHE_MEMORY_MIB` | `256` |
| `VIPS_MAX_CACHE_SIZE` | `100` |

Image profiles are defined in `internal/image/profiles.go`.
