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
contracts/    AsyncAPI contract and generated message models
client/       Demonstration client using React and Uppy 
docs/         Architecture
```

## Documentation

- [Architecture](docs/architecture.md)
- [Domain language](CONTEXT.md)

