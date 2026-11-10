# Upload benchmark

This local Docker benchmark runs the actual `client/src/upload.ts` in Chromium, through the API, MinIO, RabbitMQ and workers, until READY and verified retrieval. A separate `/app` page bundles the actual React client for independent input/drop verification. Load callbacks record timings without rendering one React interface per concurrent upload. Chromium, client scheduling, polling, hashing and network emulation costs are included in generator measurements. Sustained React rendering cost is not measured.

Protocol version `1` is the first canonical benchmark configuration. See [BASELINE.md](reports/BASELINE.md) for its baseline measurements and validation. Both short screening profiles and longer confirmation scenarios are available. Short screens do not establish production p99, rare-cohort nonregression or long-term leak freedom.

## Layout

| Path | Contents |
|---|---|
| `run.sh` | Entry command: build, deploy, archive provenance and run one scenario |
| `src/` | Generator, browser harness, client bundle build, evaluator, storage and Docker helpers |
| `tests/` | Node unit tests and the CDP network calibration check |
| `config/` | Frozen protocol, image reference, Prometheus scrape configuration and the benchmark-only versioned `documents` bucket lifecycle and policy (`config/minio/`) |
| `docker/` | Compose project, generator image and API image |
| `reports/` | Baseline measurements and validation |
| `package.json`, `package-lock.json` | Generator dependencies |

The `documents` bucket lifecycle and policy support optional versioned-document storage trials. They are mounted only by the benchmark `minio-init` service and are not production configuration.

## Run

Requires Docker Compose, Java 25 and the repository Gradle wrapper. Ports 5173, 18080, 19000, 15673, 19090 and 13000 must be free. The recorded Docker VM has 11 CPUs and about 16 GiB RAM. Every service has one replica with fixed limits in `docker/compose.yaml`; the generator has 2 CPUs and 8 GiB RAM on the same Docker bridge as the application.

```sh
./benchmark/run.sh quick baseline-q1
./benchmark/run.sh slow baseline-slow1
./benchmark/run.sh wan-multipart baseline-wan1
./benchmark/run.sh quick-faults candidate-faults1
./benchmark/run.sh quick-ramp candidate-ramp1
./benchmark/run.sh quick-overload candidate-overload1
./benchmark/run.sh quick-soak candidate-soak1
```

Run sequentially, with no concurrent builds, correctness suites or other load. `run.sh` builds the selected source, recreates only this Compose project's volumes, waits for health, archives source and deployment provenance, warms up, measures and observes drainage. It leaves services available for inspection. Startup, warmup and drainage add wall time beyond the measured interval.

Three matched mixed repeats per side are required for comparison:

```sh
node benchmark/src/evaluate.mjs \
  --baseline .local/upload-benchmark/baseline-q1,.local/upload-benchmark/baseline-q2,.local/upload-benchmark/baseline-q3 \
  --candidate .local/upload-benchmark/candidate-q1,.local/upload-benchmark/candidate-q2,.local/upload-benchmark/candidate-q3 \
  --output .local/upload-benchmark/comparison.json
```

Focused benchmark checks run from the repository root with `node --test benchmark/tests/*.test.mjs`. `tests/browser.test.mjs` also requires the benchmark dependencies, so run it inside the generator image if they are not installed locally: `docker compose -f benchmark/docker/compose.yaml run --rm --no-deps --entrypoint node generator --test tests/browser.test.mjs`. Validate browser aggregate rate and latency with `docker compose -f benchmark/docker/compose.yaml run --rm --no-deps --entrypoint node generator /bench/tests/network-check.mjs`. Stop the isolated project after saving evidence:

```sh
docker compose -f benchmark/docker/compose.yaml down --volumes --remove-orphans
```

The retained [source-read microbenchmark](../workers/internal/objectstore/source_bench_test.go) measures allocations with synthetic memory-backed S3 responses. Run `go test ./internal/objectstore -run '^$' -bench '^BenchmarkReadSource$' -benchmem` from `workers/`. It measures source buffering, not storage throughput.

The Docker socket mount permits resource reads and scheduled worker restarts. Use it only with the isolated local project. Service passwords in this deployment are synthetic fixture credentials.

## Frozen inputs

`config/protocol.json` fixes seed 276197, weights, file sizes, image dimensions, warmup, arrival segments, timeouts, recovery rules and acceptance. `docker/compose.yaml` fixes placement, replicas and resource limits. Each run archives image IDs, dependency versions, Chromium, Node, VM limits, actual source, settings and starting state. Never reuse a run label.

The twelve weighted fixtures cover 16 KiB and 1 MiB documents, 64 MiB minus one byte, exactly 64 MiB, plus one byte, and 256 MiB; JPEG at 640x480 and 3840x2160; PNG at 1920x1080 with alpha and 2560x1440 noise; WebP at 800x600 and 3000x2000. Text/solid data and seeded noise represent different compressibility. Bytes repeat deterministically across uploads. These weights and deterministic arrival times are synthetic assumptions, not measured production traffic or a Poisson arrival process.

`config/image-reference.json` freezes unchanged-worker variant hashes, lengths, dimensions and content types. Every successful document retrieval must match its original SHA-256; every image variant must match the frozen reference. Image quality or transparency changes fail verification. Regenerate references only before freezing a new evaluation, with explicit agreement when changing acceptance.

The protocol hash covers every `.mjs`, `.ts`, `.json`, `.yaml`, `.sh` and `*Dockerfile` file under the generator's `/bench` directory, recursively, keyed by its relative path and sorted by that path: source, tests, configuration including the `documents` bucket files, Docker files, the entry script and dependency locks. It excludes `node_modules/`, the `public/` build output, `reports/` and Markdown. Protocol, fixture and environment hashes must match across comparison sides.

Version numbers alone do not establish compatibility. Compare only runs with matching protocol, fixture and environment hashes. Changes to benchmark inputs or instrumentation require fresh baselines. Keep superseded, interrupted and setup-only runs separate from acceptance evidence.

## Slow connections and faults

`slow` uses a synthetic 512 KiB/s uplink, 2 MiB/s downlink and 180 ms round-trip delay with small fixtures. `wan-multipart` uses 8 MiB/s up, 16 MiB/s down and 180 ms delay for the multipart boundaries. Each Chromium page uses CDP network emulation, enabled after local page and fixture preparation. API calls, PUTs, polling and verified downloads share its upload/download limits. `tests/network-check.mjs` independently verifies single and concurrent request rates, latency, incremental progress and exact bytes. CDP is browser emulation, not host/container traffic shaping. The multipart profile does not represent the weakest broadband connection.

The fault scenario reserves its last page and uses CDP transfer throttling. Interrupted/cancelled multipart uploads require observed partial progress, an actual XHR abort and verified server ABORTED state. The harness explicitly aborts these sessions for cleanup. Lost completion responses are replayed with the same session and parts. Worker restarts occur at fixed times. Fault-page settings are archived as `protocol.faultClientNetwork`; `summary.network` describes only profiles applied to every page, so it is null for fault-only scenarios. These cases do not prove recovery of unattended abandoned clients through production expiration.

## Accounting and observations

Arrivals depend on scheduled time, independently of completion. The offered manifest is written before dispatch; a synchronous dispatch journal preserves interruption accounting. The fixed 128-inflight limit records generator rejections. Every offered operation has one terminal outcome, with expected injected faults separate from unexpected errors, timeouts and unfinished work. Generator lag remains visible.

After client tasks settle, the runner observes every Rabbit queue and durable outbox, preparation and incomplete-session counts. They must remain empty through the six-second settling window within the existing 180-second deadline. Starting queues and durable work must also be empty.

Successful test objects are removed after retrieval verification to bound local disk use. Cleanup cost remains in service counters. This retention policy does not validate production lifecycle or cleanup grace periods.

Each `.local/upload-benchmark/<label>` contains:

- Offered, dispatch and terminal journals; actual browser start, READY, verified download, stage durations, API/PUT attempts and attempted upload bytes.
- Docker CPU time, memory samples including anonymous memory, network/block I/O and throttling; browser heap/task time; broker and durable backlog observations.
- Bounded sampled traces correlated by session and asset ID. API outbox/result and worker timing logs use the same roughly one-percent asset suffix sample.
- Exact unrounded quantiles, 1 ms histograms, 95% order-statistic intervals, recovery observations, cleanup, diagnostics and measurement limits.
- Archived Prometheus series, environment, fixtures, source tarball/patch, storage settings/probes and browser evidence.

Grafana is at `http://localhost:13000`, with fixture login `admin` / `admin`. Prometheus is at `http://localhost:19090`.

## Acceptance and limits

The evaluator requires three matching repeats and at least 1,000 successful observations per evaluated group. It protects p95/p99, offered-operation outcomes, completed files/bytes throughput, generator lag, recovery and service CPU/memory/network/storage using measured baseline spread. Exact p99 intervals remain wide with small tail samples. Queueing correlations can make marginal interval uncertainty optimistic. Underpowered cohorts remain `insufficient_evidence`.

Mixed-run service counters cannot establish cohort resource nonregression. Sampled memory can miss peaks and includes page cache. Docker storage counters may omit cached/writeback activity. Rabbit queue head age is unavailable when the broker omits its timestamp; durable outbox age is still recorded. The database backlog sampler is disabled in normal deployments unless `file-upload.monitoring.backlog-enabled=true`; benchmark Compose explicitly enables it. Its one-second counts include historical-row scan costs, so enabling it in production needs a cardinality and indexing review. Zero counters do not prove zero physical work. Short-soak stability does not prove long-term leak freedom.

## Storage trials

The `BENCHMARK_MINIO_COMPRESSION=off|on` toggle is a candidate setting, default `off`. Encryption compression stays off. Fixed document extensions and the exact `application/octet-stream` MIME type are eligible; JPEG, PNG and WebP remain excluded. Every run records server settings, environment overrides, process identity and versions before/after measurement. Drift, undeclared variables and missing provenance fail comparison.

The identical preflight verifies raw document retrieval, HEAD, ranges, conditional GET, multipart and conditional worker-style copies, with CPU/network/storage deltas and stored-representation lengths. Those lengths include `xl.meta`; they are not allocated blocks or physical I/O. Probe objects are removed before warmup. Smaller stored bytes alone cannot justify adoption. Transparent storage compression does not reduce the client's upload bytes.

The runtime trial accepts `BENCHMARK_MINIO_GOMAXPROCS=2` or an unset variable for the original host-derived default. It keeps the one-CPU quota fixed. Snapshots verify the effective runtime value, visible CPUs and Go version; each comparison side must use one mode and fixed runtime provenance must match across runs. Runtime instrumentation requires fresh controls. This is an experimental setting and is not enabled by default.

## Iteration record

Keep hypotheses, focused changes, correctness evidence, matched measurements and retain/restore decisions with the ignored run artifacts. Freeze the evaluation before a campaign and keep its candidate budget and stopping rules. Choose changes from demonstrated bottlenecks and report unproved objectives explicitly.
