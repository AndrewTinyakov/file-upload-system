# Protocol version 1 baseline

Fresh mixed-traffic baseline for the first canonical benchmark configuration. These are baseline observations of the existing upload behavior with retained monitoring, not evidence of a performance improvement. Earlier campaign reports are archived locally and excluded from this baseline.

## Workload and provenance

Three sequential `quick` repeats on 2026-11-10, each with 12 seconds of warmup, 120 seconds of independently scheduled arrivals at 8 files/second, and the existing 180-second drainage deadline. Each repeat recreated project volumes and verified empty queues and durable work before measurement. Seed 276197, all twelve weighted document/JPEG/PNG/WebP fixtures, fixed image references, replicas, resource limits and acceptance rules were preserved. Weights and deterministic arrivals are synthetic assumptions.

Service source revision: `416feaa076f418c2d111d3551562f2fb6c7c22a1`. The benchmark configuration differs by its reset to version 1 and documentation cleanup; run archives preserve the actual sources. Storage compression is off and MinIO uses its original host-derived runtime setting. The Docker VM exposes 11 logical CPUs and 15.66 GiB RAM. Generator and services share that VM and Docker bridge; host interference is not isolated.

| Service | CPU quota | Memory limit |
| --- | --- | --- |
| API | 1 | 1 GiB |
| Document worker | 0.5 | 256 MiB |
| Image worker | 2 | 2 GiB |
| MinIO | 1 | 1 GiB |
| PostgreSQL | 0.5 | 512 MiB |
| RabbitMQ | 0.5 | 512 MiB |
| Prometheus | 0.25 | 256 MiB |
| Grafana | 0.25 | 512 MiB |
| Generator including Chromium | 2 | 8 GiB |

All repeats matched protocol hash `bb70da6829d748765e7f54d18c3f1242aa3c60f4984cdabd51ec5d398e02410c`, fixture hash `f5ec95ee30aafbdb5d5981c255010f69173a9311b3b9deef18a0381256f874ee`, and environment hash `fcd0240c3215f3261e6e585d344db5546f38d241773f2972335569ad8978480d`. Version numbers alone do not establish compatibility; earlier artifacts labelled version 1 have different hashes and are not this baseline.

Reproduce from the repository root with unused labels:

```sh
./benchmark/run.sh quick v1-baseline-20261110-r1
./benchmark/run.sh quick v1-baseline-20261110-r2
./benchmark/run.sh quick v1-baseline-20261110-r3
docker compose -f benchmark/docker/compose.yaml down --volumes --remove-orphans
```

The recorded labels already exist locally; choose new ones when repeating. Raw operation journals, measurements, source archives and checksums stay in ignored `.local/upload-benchmark/`. They are not uploaded GitHub artifacts. This report includes the compact results needed for review.

## Accounting and repeat variability

| Repeat | Offered / recorded | Successful | Generator rejected | Completed files/s | Successful input MiB/s | READY p99, s | Download p99, s |
| --- | --- | --- | --- | --- | --- | --- | --- |
| r1 | 960 / 960 | 957 | 3 | 6.434 | 97.901 | 31.275 | 31.477 |
| r2 | 960 / 960 | 960 | 0 | 6.536 | 99.142 | 29.500 | 29.773 |
| r3 | 960 / 960 | 960 | 0 | 6.506 | 98.687 | 29.806 | 30.056 |

Across 2880 offered operations: 2877 verified successes, 3 generator capacity rejections, 0 expected faults, 0 unexpected errors, 0 timeouts, and 0 unfinished operations. All queues and durable work drained with zero cleanup failures and empty diagnostics. Recorded retries: 0; API requests: 92174; PUT attempts: 6420; attempted upload bytes: 45807553598. Capacity rejections are offered work that the generator's fixed 128-inflight limit did not dispatch; they are not completed uploads.

Completed throughput divides verified successes and their original input bytes by time from measurement start through the later of measurement end and the final terminal operation. Successful latency distributions exclude rejected operations, which remain visible in the accounting above.

| Repeat | Generator lag p50, ms | Generator lag p99, ms | Peak sampled queued messages | Post-arrival observation, s |
| --- | --- | --- | --- | --- |
| r1 | 3.300 | 101.100 | 98 | 41.516 |
| r2 | 3.100 | 139.100 | 102 | 41.511 |
| r3 | 3.000 | 94.900 | 97 | 42.430 |

Post-arrival observation includes drainage and final provenance/storage probes, so it is not a pure queue-drain time. No fault, restart or load-reduction event is injected by `quick`; recovery time was not exercised.

## Client-observed latency

| Endpoint | p50, s | p75, s | p90, s | p95, s | p99, s | p99 marginal 95% interval, s |
| --- | --- | --- | --- | --- | --- | --- |
| Scheduled arrival to READY | 5.849 | 14.175 | 23.765 | 28.013 | 30.039 | 29.776 to 30.451 |
| Client start to READY | 5.836 | 14.159 | 23.711 | 28.008 | 30.034 | 29.773 to 30.449 |
| Scheduled arrival to verified download | 6.189 | 14.653 | 24.696 | 28.308 | 30.418 | 30.126 to 30.869 |
| Client start to verified download | 6.180 | 14.651 | 24.639 | 28.281 | 30.416 | 30.120 to 30.867 |

2877 successful observations are pooled above. Quantiles use exact nearest rank on unrounded observations; archived histograms have 1 ms bins and displayed values are rounded. Intervals use binomial order statistics and assume independent observations. Queueing correlations and shared-host effects can make these marginal intervals optimistic. Repeat-to-repeat variability remains visible above and cannot be inferred from pooled intervals alone.

## Client stages and cohorts

| Client stage | p50, s | p95, s | p99, s |
| --- | --- | --- | --- |
| creating | 0.019 | 0.173 | 0.356 |
| preparing | 4.348 | 27.537 | 29.591 |
| ready | 0.190 | 0.952 | 2.147 |
| uploading | 0.130 | 2.924 | 7.094 |

These stages use client callbacks. Preparing includes queueing, worker preparation and polling; it is not isolated worker CPU time. The ready stage includes verified retrieval.

| Fixture cohort | Offered / successful | READY p50, s | READY p95, s | READY p99, s | Download p99, s | At least 1,000 successes |
| --- | --- | --- | --- | --- | --- | --- |
| jpeg-large.jpeg | 300 / 300 | 13.168 | 30.167 | 31.548 | 31.919 | no |
| jpeg-small.jpeg | 261 / 261 | 11.947 | 28.659 | 29.774 | 29.832 | no |
| noise-boundary.bin | 123 / 123 | 5.141 | 12.913 | 15.077 | 15.648 | no |
| noise-large.bin | 54 / 54 | 13.224 | 26.710 | 29.732 | 31.197 | no |
| noise-medium.bin | 417 / 417 | 1.258 | 3.762 | 4.889 | 4.947 | no |
| png-alpha.png | 303 / 302 | 15.125 | 28.718 | 29.504 | 29.550 | no |
| png-noise.png | 222 / 222 | 12.873 | 28.882 | 29.915 | 30.408 | no |
| text-boundary-above.bin | 126 / 126 | 5.368 | 12.558 | 14.374 | 14.879 | no |
| text-boundary-below.bin | 135 / 135 | 3.449 | 7.770 | 9.523 | 10.148 | no |
| text-small.bin | 522 / 521 | 1.251 | 3.319 | 4.152 | 4.320 | no |
| webp-large.webp | 123 / 123 | 17.662 | 30.029 | 32.129 | 32.374 | no |
| webp-small.webp | 294 / 293 | 11.027 | 27.542 | 28.862 | 29.041 | no |

Cohort percentiles are descriptive. Cohorts below the frozen 1,000-success threshold remain insufficient evidence for tail-latency acceptance; this short mixed baseline cannot establish per-cohort resource nonregression.

## Resource costs

Each cell below reports the median across three repeats followed by the observed minimum and maximum. CPU and traffic totals include the measurement and drainage period, retries, failed attempts and object cleanup, then divide by successful uploads. Generator counters include Chromium and the Node harness.

| Service | CPU seconds/success | Peak sampled memory, MiB | Network RX+TX MiB/success | Block reads+writes MiB/success |
| --- | --- | --- | --- | --- |
| api | 0.056 [0.054, 0.057] | 414.621 [410.941, 416.035] | 0.113 [0.112, 0.114] | 0.004 [0.002, 0.005] |
| document-worker | 0.001 [0.001, 0.001] | 18.543 [15.504, 24.871] | 0.005 [0.005, 0.005] | 0.016 [0.013, 0.016] |
| generator | 0.204 [0.201, 0.209] | 4003.871 [3830.488, 4070.055] | 30.119 [30.117, 30.193] | 0.202 [0.116, 0.232] |
| grafana | 0.006 [0.004, 0.007] | 512.000 [511.996, 512.000] | 0.063 [0.061, 0.078] | 1.044 [0.928, 1.298] |
| image-worker | 0.285 [0.284, 0.288] | 2047.914 [2007.352, 2047.996] | 2.966 [2.964, 2.975] | 0.015 [0.006, 0.587] |
| minio | 0.122 [0.121, 0.128] | 1024.000 [1024.000, 1024.000] | 33.017 [33.015, 33.101] | 48.689 [47.810, 53.188] |
| postgres | 0.009 [0.009, 0.010] | 91.906 [82.109, 108.734] | 0.024 [0.023, 0.024] | 0.100 [0.095, 0.103] |
| prometheus | 0.001 [0.001, 0.002] | 78.559 [72.449, 97.289] | 0.019 [0.019, 0.020] | 0.070 [0.061, 0.085] |
| rabbitmq | 0.018 [0.016, 0.018] | 234.262 [217.414, 243.988] | 0.009 [0.009, 0.009] | 0.048 [0.044, 0.052] |

Total measured container CPU seconds per success by repeat: 0.709, 0.709, 0.696. These include generator and monitoring containers. Network figures are per-container interface counters and count both sides of inter-container transfers; they are not unique physical wire bytes. Block counters can omit cached/writeback I/O, and sampled memory can miss peaks and includes page cache. Queue head age is unavailable from this broker.

## Validation and limits

Successful document downloads matched the original SHA-256, and image variants matched the frozen hashes, lengths, dimensions and content types. Every run passed the storage compatibility preflight and offered-operation accounting, completed queue/durable drainage and cleanup checks. No candidate comparison or improvement verdict is made.

This is a short mixed baseline, not a production capacity or high-load certification. Slow links, multipart fault injection, worker restarts, ramps, overload recovery and sustained resource growth were not rerun for this report. Their scenarios remain available. Separate confirmation and enough successful samples are required before making those claims or accepting a future performance candidate.
