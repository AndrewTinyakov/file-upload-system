#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
scenario="${1:-smoke}"
label="${2:-${scenario}-$(date -u +%Y%m%dT%H%M%SZ)}"
case "$label" in *[!a-zA-Z0-9_-]*|'') exit 2;; esac
case "${BENCHMARK_MINIO_COMPRESSION:-off}" in off|on) ;; *) exit 2;; esac
case "${BENCHMARK_MINIO_GOMAXPROCS:-}" in ''|2) ;; *) exit 2;; esac
test ! -e ".local/upload-benchmark/$label"
mkdir -p .local/upload-benchmark
compose=(docker compose -f benchmark/docker/compose.yaml)
trap '"${compose[@]}" logs --no-color > ".local/upload-benchmark/$label-services.log" 2>&1 || true' EXIT
./api/gradlew -p api clean bootJar --console=plain
"${compose[@]}" build api generator document-worker image-worker
"${compose[@]}" down --volumes --remove-orphans
"${compose[@]}" up -d postgres rabbitmq minio minio-init api document-worker image-worker prometheus grafana
for attempt in $(seq 1 90); do
  if curl -fsS http://localhost:18080/api/actuator/health >/dev/null; then break; fi
  if [ "$attempt" -eq 90 ]; then exit 1; fi
  sleep 2
done
git rev-parse HEAD > ".local/upload-benchmark/$label-head.txt"
git diff --binary HEAD -- client api workers > ".local/upload-benchmark/$label-source.patch"
tar --exclude=node_modules --exclude=build --exclude=.gradle --exclude=.local -czf ".local/upload-benchmark/$label-sources.tar.gz" api/src api/build.gradle.kts client/src client/package.json workers contracts benchmark package.json package-lock.json infra
"${compose[@]}" config > ".local/upload-benchmark/$label-compose.yaml"
SCENARIO="$scenario" RUN_LABEL="$label" "${compose[@]}" run --rm generator
"${compose[@]}" logs --no-color > ".local/upload-benchmark/$label-services.log"
