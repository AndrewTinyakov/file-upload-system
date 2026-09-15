CREATE TYPE file_handling_mode AS ENUM (
    'DOCUMENT',
    'IMAGE'
);

CREATE TYPE file_asset_status AS ENUM (
    'AWAITING_UPLOAD',
    'PREPARING',
    'READY',
    'FAILED'
);

CREATE TABLE file_assets (
    id VARCHAR(26) PRIMARY KEY,
    owner_id VARCHAR(26) NOT NULL,
    original_filename TEXT NOT NULL,
    content_type TEXT NOT NULL,
    byte_size BIGINT NOT NULL,
    handling_mode file_handling_mode NOT NULL,
    processing_profile_name TEXT,
    processing_profile_version INTEGER,
    status file_asset_status NOT NULL DEFAULT 'AWAITING_UPLOAD',
    failure_code TEXT,
    bucket TEXT NOT NULL,
    prefix TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT file_assets_location_unique
        UNIQUE (bucket, prefix),
    CONSTRAINT file_assets_id_owner_unique
        UNIQUE (id, owner_id),
    CONSTRAINT file_assets_byte_size_nonnegative
        CHECK (byte_size >= 0),
    CONSTRAINT file_assets_processing_profile_valid
        CHECK (
            (
                handling_mode = 'DOCUMENT'
                AND processing_profile_name IS NULL
                AND processing_profile_version IS NULL
            )
            OR
            (
                handling_mode = 'IMAGE'
                AND processing_profile_name IS NOT NULL
                AND processing_profile_name <> ''
                AND processing_profile_version IS NOT NULL
                AND processing_profile_version > 0
            )
        ),
    CONSTRAINT file_assets_failure_valid
        CHECK (
            (
                status = 'FAILED'
                AND failure_code IS NOT NULL
                AND failure_code <> ''
            )
            OR
            (
                status <> 'FAILED'
                AND failure_code IS NULL
            )
        )
);

CREATE INDEX file_assets_owner_created_idx
    ON file_assets (owner_id, created_at DESC);

CREATE INDEX file_assets_failed_updated_idx
    ON file_assets (updated_at)
    WHERE status = 'FAILED';

CREATE TYPE upload_strategy AS ENUM (
    'SINGLE',
    'MULTIPART'
);

CREATE TYPE upload_session_status AS ENUM (
    'CREATED',
    'COMPLETED',
    'ABORTED',
    'EXPIRED'
);

CREATE TABLE upload_sessions (
    id VARCHAR(26) PRIMARY KEY,
    file_asset_id VARCHAR(26) NOT NULL,
    owner_id VARCHAR(26) NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_fingerprint VARCHAR(64) NOT NULL,
    strategy upload_strategy NOT NULL,
    status upload_session_status NOT NULL DEFAULT 'CREATED',
    uploaded_object_bucket TEXT NOT NULL,
    uploaded_object_key TEXT NOT NULL,
    provider_upload_id TEXT,
    object_etag TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT upload_sessions_asset_owner_fk
        FOREIGN KEY (file_asset_id, owner_id)
        REFERENCES file_assets (id, owner_id),
    CONSTRAINT upload_sessions_file_asset_unique
        UNIQUE (file_asset_id),
    CONSTRAINT upload_sessions_owner_idempotency_unique
        UNIQUE (owner_id, idempotency_key),
    CONSTRAINT upload_sessions_uploaded_object_unique
        UNIQUE (uploaded_object_bucket, uploaded_object_key),
    CONSTRAINT upload_sessions_request_fingerprint_valid
        CHECK (char_length(request_fingerprint) = 64),
    CONSTRAINT upload_sessions_strategy_valid
        CHECK (
            (strategy = 'SINGLE' AND provider_upload_id IS NULL)
            OR
            (strategy = 'MULTIPART' AND provider_upload_id IS NOT NULL)
        ),
    CONSTRAINT upload_sessions_completion_valid
        CHECK (
            (status = 'COMPLETED' AND completed_at IS NOT NULL)
            OR
            (status <> 'COMPLETED' AND completed_at IS NULL)
        ),
    CONSTRAINT upload_sessions_expiry_valid
        CHECK (expires_at > created_at)
);

CREATE INDEX upload_sessions_expiry_idx
    ON upload_sessions (expires_at)
    WHERE status = 'CREATED';

CREATE TYPE asset_variant_type AS ENUM (
    'ORIGINAL',
    'DISPLAY_SMALL',
    'DISPLAY_MEDIUM',
    'DISPLAY_LARGE',
    'DOWNLOAD'
);

CREATE TABLE asset_variants (
    id VARCHAR(26) PRIMARY KEY,
    file_asset_id VARCHAR(26) NOT NULL REFERENCES file_assets (id),
    variant_type asset_variant_type NOT NULL,
    bucket TEXT NOT NULL,
    object_key TEXT NOT NULL,
    content_type TEXT NOT NULL,
    byte_size BIGINT NOT NULL,
    width INTEGER,
    height INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT asset_variants_asset_type_unique
        UNIQUE (file_asset_id, variant_type),
    CONSTRAINT asset_variants_byte_size_nonnegative
        CHECK (byte_size >= 0),
    CONSTRAINT asset_variants_dimensions_valid
        CHECK (
            (width IS NULL AND height IS NULL)
            OR
            (
                width IS NOT NULL
                AND width > 0
                AND height IS NOT NULL
                AND height > 0
            )
        )
);

CREATE TABLE outbox_messages (
    id VARCHAR(26) PRIMARY KEY,
    aggregate_type TEXT NOT NULL,
    aggregate_id VARCHAR(26) NOT NULL,
    message_type TEXT NOT NULL,
    exchange_name TEXT NOT NULL,
    routing_key TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at TIMESTAMPTZ
);

CREATE INDEX outbox_messages_unpublished_idx
    ON outbox_messages (created_at, id)
    WHERE published_at IS NULL;
