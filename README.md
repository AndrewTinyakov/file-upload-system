# Scalable file upload system

A pet project for file uploads and asynchronous preparation.

## Scope

- Documents are stored unchanged.
- Static JPEG, PNG, and WebP images are converted into display and download variants.
- Clients upload directly to S3-compatible storage with presigned URLs.

## Repository

```text
api/          Kotlin Spring Boot API  
workers/      Go document and image workers
contracts/    AsyncAPI contract and payload schemas
client/       Demonstration client using React and Uppy 
docs/         Architecture
```

## Documentation

- [Architecture](docs/architecture.md)
- [Domain language](CONTEXT.md)
- [Local development](docs/local-development.md)

## Message contracts

[`contracts/asyncapi.yaml`](contracts/asyncapi.yaml) defines the RabbitMQ
messages. Install the pinned tooling, validate the contract, and regenerate
the committed Kotlin and Go models with:

```shell
npm ci
npm run validate:asyncapi
npm run generate:asyncapi:kotlin
npm run generate:asyncapi:go
```

Generated code lives in `api/src/generated/asyncapi/kotlin` and
`workers/internal/generated/messaging`. Do not edit it manually. Worker setup
is documented in [`workers/README.md`](workers/README.md).
