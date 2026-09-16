# Local development

Requires Docker with Compose, Java 25, Node.js 24.11, and Go 1.26.

Running all Go worker tests on the host also requires libvips and `pkg-config`:

```bash
brew install vips pkg-config
```

The worker container build installs libvips itself, so the host dependency is
not required when building with Docker.

From the repository root:

```bash
docker compose -f compose.local.yaml up -d
./api/gradlew -p api bootRun --args="--spring.profiles.active=local"
```

Compose starts PostgreSQL, RabbitMQ, and MinIO. The API runs on the host and applies Flyway migrations at startup.

Build and test the worker module:

```bash
npm ci
npm run generate:asyncapi:go
go -C workers test ./...
```

## Database code generation

After Flyway has applied the migrations, regenerate the jOOQ sources:

```bash
./api/gradlew -p api jooqCodegen
```

The generated Java sources are stored in `api/src/generated/java` and are committed with the schema change. The generator connects to `jdbc:postgresql://localhost:5432/file_upload` with the local credentials by default. Set `JOOQ_DB_URL`, `JOOQ_DB_USER`, and `JOOQ_DB_PASSWORD` to use a different database.

Useful addresses:

- RabbitMQ: <http://localhost:15672>
- MinIO: <http://localhost:9001>
- PostgreSQL: `localhost:5432/file_upload`

The username and password for all three services are `file_upload`.

Stop the services without deleting their data:

```bash
docker compose -f compose.local.yaml down
```

Reset them and delete all local data:

```bash
docker compose -f compose.local.yaml down --volumes
```

## Troubleshooting

Check status or follow logs:

```bash
docker compose -f compose.local.yaml ps
docker compose -f compose.local.yaml logs -f
```

If a port is busy, override `POSTGRES_PORT`, `RABBITMQ_AMQP_PORT`, `RABBITMQ_MANAGEMENT_PORT`, `MINIO_API_PORT`, or `MINIO_CONSOLE_PORT` before running both startup commands.
