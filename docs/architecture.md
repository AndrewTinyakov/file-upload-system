# Architecture

## System overview

```mermaid
flowchart LR
    C[React client<br/>Uppy]
    API[Spring Boot API]
    DB[(PostgreSQL)]
    MQ[[RabbitMQ]]

    subgraph W[Go worker pools]
        direction TB
        DW[Document]
        IW[Image]
    end

    subgraph S[Object storage]
        direction TB
        U[(uploads)]
        A[(assets)]
    end

    C -->|upload sessions and asset state| API
    API -->|presigned URLs| C
    C ==>|file bytes| U
    API --> DB
    API <-->|commands and events| MQ
    MQ <-->|jobs and events| DW
    MQ <-->|jobs and events| IW
    DW -->|read| U
    IW -->|read| U
    DW -->|write| A
    IW -->|write| A
```

The API handles metadata, authorization placeholders, upload coordination, and state. File bytes never pass through it. Clients upload directly to S3-compatible storage, and Go workers prepare uploaded objects asynchronously.

PostgreSQL stores file assets, upload sessions, asset variants, and outbox messages. One S3-compatible installation provides an `uploads` bucket for temporary input and an `assets` bucket for permanent output. Local development uses MinIO; a deployment can use S3 and a CDN.

### RabbitMQ routing

```mermaid
flowchart LR
    OP[API outbox publisher]
    CX{{asset.commands}}
    DQ[[document.jobs]]
    IQ[[image.jobs]]
    DW[Document worker pool]
    IW[Image worker pool]
    EX{{asset.events}}
    EQ[[backend.asset-events]]
    EC[API event consumer]
    DX{{asset.dead}}
    DLQ[[backend.preparation-dead]]
    DC[API dead-letter consumer]

    OP --> CX
    CX -->|document.prepare.v1| DQ
    CX -->|image.prepare.v1| IQ
    DQ --> DW
    IQ --> IW
    DW --> EX
    IW --> EX
    EX --> EQ
    EQ --> EC
    DQ -->|delivery limit exceeded| DX
    IQ -->|delivery limit exceeded| DX
    DX --> DLQ
    DLQ --> DC
```

The publisher and consumers above run inside the Spring Boot API for now. They can be deployed separately later without changing the message contracts. Hexagons are exchanges; double-bordered boxes are queues.

## Upload and preparation sequence

```mermaid
sequenceDiagram
    autonumber

    participant C as Client
    participant API as Spring API
    participant DB as PostgreSQL
    participant U as uploads bucket
    participant OP as Outbox publisher<br/>(inside Spring API)
    participant MQ as RabbitMQ
    participant W as Selected worker
    participant A as assets bucket

    C->>API: POST /upload-sessions<br/>filename, contentType, byteSize, handlingMode

    opt Multipart upload
        API->>U: CreateMultipartUpload
        U-->>API: provider uploadId
    end

    API->>DB: Transaction: create FileAsset and UploadSession
    DB-->>API: assetId and sessionId
    API-->>C: 201 Created<br/>assetId, sessionId, upload strategy<br/>presigned PUT URL when single

    alt Single upload
        C->>U: PUT object
        U-->>C: success
    else Multipart upload
        loop URL batches with concurrent part uploads
            C->>API: request signed URLs for part numbers
            API-->>C: presigned UploadPart URLs
            C->>U: PUT each part
            U-->>C: ETag for each part
        end
    end

    C->>API: POST /upload-sessions/{sessionId}/complete<br/>final part list when multipart
    opt Multipart upload
        API->>U: CompleteMultipartUpload
        U-->>API: completed object
    end
    API->>U: HEAD uploaded object
    U-->>API: object metadata
    Note over API: Verify object exists and byte size matches

    API->>DB: Transaction:<br/>UploadSession = COMPLETED<br/>FileAsset = PREPARING<br/>insert outbox message
    API-->>C: 202 Accepted<br/>assetId, PREPARING
    Note over C,API: Client short-polls GET /assets/{assetId}<br/>until READY or FAILED

    Note over OP: Runs inside Spring API<br/>Can be deployed separately later
    OP->>DB: Claim outbox rows<br/>FOR UPDATE SKIP LOCKED
    DB-->>OP: unpublished commands
    OP->>MQ: publish document.prepare.v1<br/>or image.prepare.v1
    MQ-->>OP: publisher confirm
    OP->>DB: mark outbox row published

    MQ->>W: deliver preparation command
    W->>A: GET destination/complete.json

    alt Valid completion record exists
        A-->>W: prepared variant details
    else No completion record
        A-->>W: not found

        alt DOCUMENT
            W->>A: CopyObject from uploads bucket
            A-->>W: ORIGINAL variant stored
        else IMAGE
            W->>U: GET uploaded object
            U-->>W: uploaded bytes
            Note over W: Detect and decode JPEG, PNG, or WebP<br/>Apply the named processing profile
            W->>A: PUT prepared variants
            A-->>W: image variants stored
        end

        W->>A: PUT complete.json last
        A-->>W: outputs committed
    end

    W->>MQ: publish asset.preparation.completed.v1
    MQ-->>W: publisher confirm
    W->>MQ: acknowledge preparation command

    MQ->>API: deliver completion event
    API->>DB: Transaction:<br/>lock FileAsset<br/>validate and store variants<br/>FileAsset = READY
    API->>MQ: acknowledge completion event

    C->>API: GET /assets/{assetId}
    API->>DB: read asset and variants
    DB-->>API: READY and variant metadata
    API-->>C: direct variant URLs
```

For a single upload, the session response includes the presigned `PUT` URL. For multipart upload, the client requests presigned part URLs in batches, uploads those parts directly, and records the ETag returned for each part. The completion request carries the ordered part-number and ETag pairs, completes the multipart object, and then performs the same verification as a single upload. Calling completion again returns the existing result.

## Preparation

`DOCUMENT` accepts arbitrary bytes. The document worker performs a server-side copy into the `assets` bucket and returns one `ORIGINAL` variant. Large objects use multipart copy when the storage provider requires it.

`IMAGE` accepts static JPEG, PNG, and WebP. The image worker uses libvips through govips. A versioned profile owned by worker code produces:

| Variant | Output |
| --- | --- |
| `DISPLAY_SMALL` | WebP, maximum width 480 |
| `DISPLAY_MEDIUM` | WebP, maximum width 1280 |
| `DISPLAY_LARGE` | WebP, maximum width 1920 |
| `DOWNLOAD` | Optimized JPEG, or PNG when transparency is required |

Images are never upscaled. Several logical variants may reference the same stored object when the input is smaller than a profile size.

Spring assigns an opaque destination prefix such as `assets/{assetId}/`. The worker owns the names beneath it and returns object keys, content types, byte sizes, and image dimensions in the completion event. Spring validates that every key remains beneath the assigned prefix, but it does not issue a `HEAD` request for every output.

The uploaded object is not an asset variant. Workers write `complete.json` after every variant has been stored. On retry, it tells the worker that preparation already finished and provides the prepared variant details needed for the completion event. Clients never receive this file.

## Failure sequence

```mermaid
sequenceDiagram
    autonumber

    participant W as Worker
    participant MQ as RabbitMQ quorum queue
    participant API as Spring API
    participant DB as PostgreSQL

    alt Permanent input error
        W->>MQ: publish asset.preparation.failed.v1
        MQ-->>W: publisher confirm
        W->>MQ: acknowledge command
        MQ->>API: deliver failure event
        API->>DB: FileAsset = FAILED<br/>store stable failure code
        API->>MQ: acknowledge failure event
    else Recoverable failure or worker crash
        W->>MQ: reject or lose unacknowledged delivery
        MQ->>MQ: delayed redelivery with backoff
        alt A later attempt succeeds
            W->>MQ: publish completion and acknowledge
        else Delivery limit is exceeded
            MQ->>API: dead-letter preparation command
            API->>DB: FileAsset = FAILED<br/>failureCode = RETRY_EXHAUSTED
            API->>MQ: acknowledge dead-lettered command
        end
    end
```

RabbitMQ 4.3 quorum queues provide delayed retry, a configurable delivery limit, consumer timeout, dead-lettering, and an `x-delivery-count` header. Workers use manual acknowledgements, and all event publishers wait for publisher confirms.

## State changes

A `FileAsset` moves from `AWAITING_UPLOAD` to `PREPARING` once its upload completes, then to `READY` after preparation. An upload or preparation failure moves it to `FAILED`. A valid completion arriving after retry exhaustion can still move it from `FAILED` to `READY`.

An `UploadSession` starts as `CREATED` and ends as `COMPLETED`, `ABORTED`, or `EXPIRED`.

## Consistency

- Creating an upload session accepts an `Idempotency-Key`. The unique business key is `(owner_id, idempotency_key)`. Reusing a key with different request data returns `409 Conflict`.
- Completing or aborting an upload session is idempotent.
- The outbox connects the database transaction to command publication. Every API instance may publish rows claimed with `FOR UPDATE SKIP LOCKED`.
- RabbitMQ delivery is at least once. Workers use deterministic output keys and check `complete.json` before repeating work.
- Completion handling locks the file asset and relies on a unique `(asset_id, variant_type)` constraint. Repeated equivalent events succeed. Conflicting events are rejected and reported.

## Cleanup and scaling

An object-storage lifecycle rule removes every source object from the `uploads` bucket after seven days. This covers completed, failed, and abandoned uploads.

A separate lifecycle rule aborts incomplete multipart uploads after one day. Until a multipart upload is completed or aborted, its uploaded parts remain stored even though there is no readable object yet.

A scheduled task in Spring claims old failed assets with `FOR UPDATE SKIP LOCKED`. After a grace period, it checks the state again and removes partial objects beneath the destination prefix. User-requested deletion of permanent assets is outside scope.

The API is stateless outside PostgreSQL. Document and image workers consume separate queues, so each pool can be scaled independently. RabbitMQ absorbs temporary backlogs. Queue depth, oldest message age, processing duration, failures, and dead letters are monitored. Autoscaling and Kubernetes are outside scope.

Clients receive direct object URLs built from the stored bucket and object key. Example uses opaque keys as unguessable public links. Signed read URLs and authorization can be added later.
