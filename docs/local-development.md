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
docker compose -f compose.local.yaml up -d --build
./api/gradlew -p api bootRun --args="--spring.profiles.active=local"
```

Compose starts PostgreSQL, RabbitMQ, MinIO, and both Go workers. Its MinIO initializer applies upload retention and public asset-read policies. The API runs on the host and applies Flyway migrations at startup.

Compose also starts Prometheus, Grafana, and Alertmanager. Grafana loads the Prometheus data source and the `File upload overview` dashboard automatically. Published ports bind to `127.0.0.1`.

Run the API integration suite with `./api/gradlew -p api test`; it starts isolated containers and requires Docker.

With the local stack and API running, run the full system tests with `npm run test:system`.

Validate the monitoring configuration and alert rules with `npm run test:monitoring`.

Build and test the worker module:

```bash
npm ci
npm run generate:asyncapi:go
go -C workers test ./...
```

To run multiple worker replicas, use the scaling override:

```bash
docker compose -f compose.local.yaml -f compose.scale.yaml up -d --scale document-worker=3 --scale image-worker=2
```

Prometheus discovers the worker containers. The default single-worker setup keeps the host metrics ports available.

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
- API metrics: <http://localhost:8080/api/actuator/prometheus> (`metrics` / `metrics-local`)
- Document worker metrics: <http://localhost:2112/metrics>
- Image worker metrics: <http://localhost:2113/metrics>
- RabbitMQ metrics: <http://localhost:15692/metrics>
- Prometheus: <http://localhost:9090>
- Alertmanager: <http://localhost:9093>
- Grafana: <http://localhost:3000> (`admin` / `admin`)

The username and password for RabbitMQ, MinIO, and PostgreSQL are `file_upload`.

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

If a port is busy, override the matching port variable in `compose.local.yaml` before starting the stack.
