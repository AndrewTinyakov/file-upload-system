# Local development

Requires Docker with Compose and Java 25.

From the repository root:

```bash
docker compose -f compose.local.yaml up -d
./api/gradlew -p api bootRun --args="--spring.profiles.active=local"
```

Compose starts PostgreSQL, RabbitMQ, and MinIO. The API runs on the host and applies Flyway migrations at startup.

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
