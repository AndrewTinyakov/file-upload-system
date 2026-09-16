FROM golang:1.26-bookworm AS build

RUN apt-get update \
    && apt-get install -y --no-install-recommends libvips-dev pkg-config \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go test ./...
RUN CGO_ENABLED=1 go build -trimpath -o /out/image-worker ./cmd/image-worker

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates libvips42 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /out/image-worker /usr/local/bin/image-worker
USER 65532:65532
ENTRYPOINT ["image-worker"]
