# Protocol version 1 run results

**The real CLI run failed the existing checks. A clean baseline was not established.** Three repeats were planned; the campaign stopped after the first returned exit code 1 with unexpected timeouts and incomplete durable work. Acceptance rules were preserved.

## Workload and provenance

Run on 2026-11-11 through the actual Node CLI, with automatically generated name `quick-20261111T142327496Z-94b8ef8d`. The `quick` scenario used 12 seconds of warmup, 120 measured seconds at 8 independently scheduled arrivals/second, a 120-second operation timeout and the existing 180-second drainage deadline. Project volumes, queues and durable work started empty. Seed 276197, twelve weighted document/JPEG/PNG/WebP fixtures, multipart boundaries, image references, replicas, quotas and acceptance rules were unchanged. The workload weights and deterministic arrivals are synthetic assumptions.

Service source revision: `3956e3bb280e500c81f853aa8e352b732e9e069e`; the archived service patch is empty. The new CLI, helper tests, npm entrypoint and README are included in the source archive and published with this report. Compression was off and MinIO used its host-derived runtime setting. The generator and services shared the same Docker VM with 11 logical CPUs and 15.66 GiB RAM.

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

Protocol hash: `dea10778046565f5f29dc8121687d1487602dfe98573399dc9636144b3e41ac8`. Fixture hash: `f5ec95ee30aafbdb5d5981c255010f69173a9311b3b9deef18a0381256f874ee`. Environment hash: `fcd0240c3215f3261e6e585d344db5546f38d241773f2972335569ad8978480d`. Future comparisons require matching hashes and fresh clean repeats. This run must not be accepted as a passing control.

Host conditions were uncontrolled. 80 unrelated containers were initially observed. The captured pre-run sample recorded load averages of 18.44/26.80/24.99 and about 5.85 GiB of swap in use. The shared host was not isolated. Resource pressure was observed, but this run does not isolate its causal contribution from service behavior. Other projects were not stopped or reconfigured.

To run the same scenario from the repository root:

```sh
npm run bench -- run --scenario quick
npm run bench -- stop
```

## Offered work and failure outcomes

| Outcome | Count |
| --- | --- |
| Offered / recorded | 960 / 960 |
| Verified successes | 292 |
| Generator capacity rejections | 656 |
| Unexpected timeouts | 12 |
| Other unexpected errors | 0 |
| Expected injected faults | 0 |
| Client operations without a terminal record | 0 |
| Server sessions still incomplete at deadline | 8 |

The fixed 128-inflight generator limit rejected offered work without dispatching it. Rejections are not completed uploads. Timeouts are unexpected outcomes, not injected faults. Complete client accounting does not mean that server-side work drained.

Timeouts occurred during uploading in 8 cases, preparation/polling in 1 and verified retrieval after READY in 3. At the final deadline, every Rabbit queue was empty and durable outbox/preparation counts were zero, but 8 sessions remained incomplete. Fixture cleanup reported 0 failures; that counter does not cover abandonment recovery for these sessions. Post-arrival observation lasted 182.879 seconds including final probes. Recovery of abandoned sessions was not established.

Completed throughput was 1.796 verified files/s and 20.408 input MiB/s. Its denominator was 162.584 seconds from measurement start through the later of measurement end and the final terminal operation. Recorded retries: 0. API requests: 3298. PUT attempts: 630. Attempted upload bytes: 4667813193.

Generator lag p50/p99 was 24.000/1290.900 ms. Peak sampled queue depth was 50 messages. Broker head age was unavailable. Resource measurement coverage was complete, with no collection diagnostics.

## Latency among verified successes

| Endpoint | p50, s | p75, s | p90, s | p95, s | p99, s | p99 marginal 95% interval, s |
| --- | --- | --- | --- | --- | --- | --- |
| Scheduled arrival to READY | 39.152 | 56.857 | 67.867 | 72.106 | 87.590 | 77.071 to unbounded |
| Client start to READY | 39.035 | 56.715 | 67.753 | 71.548 | 87.549 | 76.978 to unbounded |
| Scheduled arrival to verified download | 54.293 | 68.759 | 88.021 | 104.447 | 114.231 | 109.280 to unbounded |
| Client start to verified download | 54.237 | 68.735 | 87.977 | 104.442 | 114.031 | 109.269 to unbounded |

These distributions include only the 292 verified successes, excluding rejected and timed-out work. They cannot establish the latency of all offered uploads. There are fewer than 1,000 successes, so even the global group is underpowered; the upper p99 confidence bound is unbounded. Quantiles use exact nearest rank on unrounded observations, archived histograms have 1 ms bins, and displayed values are rounded. Binomial order-statistic intervals assume independent observations; queueing correlations and host interference can make marginal uncertainty optimistic. There are no repeatability estimates from this single attempt.

| Successful client stage | p50, s | p75, s | p90, s | p95, s | p99, s |
| --- | --- | --- | --- | --- | --- |
| creating | 1.839 | 4.289 | 14.653 | 22.979 | 26.157 |
| preparing | 24.589 | 41.195 | 51.909 | 53.474 | 55.975 |
| ready | 6.893 | 19.251 | 30.175 | 35.386 | 41.567 |
| uploading | 5.693 | 14.023 | 21.381 | 36.200 | 76.367 |

Preparation includes queueing, worker work and polling. The ready stage includes verified retrieval; these are client callbacks, not isolated worker CPU times.

| Fixture cohort | Offered | Successful | Rejected | Timeouts | Download p50, s | Download p99, s |
| --- | --- | --- | --- | --- | --- | --- |
| jpeg-large.jpeg | 100 | 29 | 71 | 0 | 74.947 | 115.186 |
| jpeg-small.jpeg | 87 | 24 | 63 | 0 | 57.835 | 100.135 |
| noise-boundary.bin | 41 | 12 | 24 | 5 | 41.948 | 115.403 |
| noise-large.bin | 18 | 1 | 14 | 3 | 66.335 | 66.335 |
| noise-medium.bin | 139 | 40 | 99 | 0 | 34.392 | 61.586 |
| png-alpha.png | 101 | 37 | 64 | 0 | 60.692 | 104.576 |
| png-noise.png | 74 | 18 | 56 | 0 | 73.078 | 106.486 |
| text-boundary-above.bin | 42 | 9 | 29 | 4 | 49.163 | 113.692 |
| text-boundary-below.bin | 45 | 19 | 26 | 0 | 66.544 | 110.606 |
| text-small.bin | 174 | 49 | 125 | 0 | 15.442 | 63.535 |
| webp-large.webp | 41 | 19 | 22 | 0 | 62.385 | 89.413 |
| webp-small.webp | 98 | 35 | 63 | 0 | 55.913 | 101.168 |

Every cohort is below 1,000 successes. Cohort percentiles are descriptive and do not establish tail or resource nonregression.

## Resource costs

| Service | CPU seconds/success | Peak sampled memory, MiB | Network RX+TX MiB/success | Block reads+writes MiB/success |
| --- | --- | --- | --- | --- |
| api | 0.326 | 403.789 | 0.319 | 0.570 |
| document-worker | 0.007 | 20.238 | 0.006 | 0.126 |
| generator | 0.503 | 2779.637 | 27.138 | 13.764 |
| grafana | 0.068 | 511.977 | 0.192 | 8.428 |
| image-worker | 0.640 | 1741.734 | 2.880 | 1.614 |
| minio | 0.322 | 1023.973 | 29.806 | 53.629 |
| postgres | 0.055 | 101.371 | 0.016 | 0.850 |
| prometheus | 0.019 | 92.336 | 0.116 | 1.277 |
| rabbitmq | 0.163 | 234.148 | 0.034 | 0.380 |

Total measured container CPU cost was 2.102 seconds per verified success. Counters include measurement, deadline observation, retries, failed work and verified-object cleanup; generator counters include Chromium and Node. Network counters include both ends of inter-container transfers. Block counters may omit cached/writeback I/O; sampled memory can miss peaks and includes page cache. These are measured costs under a failed workload, not efficiency improvements.

## CLI, correctness and monitoring evidence

The new CLI built and started the actual Docker deployment, generated the run name, archived source/configuration, saved service logs and propagated the generator failure as exit code 1. Successful documents matched their original SHA-256; image variants matched the frozen bytes, sizes, dimensions and content types. The storage compatibility preflight passed. No performance candidate was enabled.

All 34 dependency-free helper tests and 3 browser harness tests passed. Five Prometheus targets were up and Grafana reported a healthy database. The document worker had one startup restart before measurement; no project OOM was observed in the captured inspections. No restart fault was injected.

Before teardown, the failed database state and service logs were saved locally. `npm run bench -- stop` then removed the benchmark containers and volumes. That reset removes local failed sessions and is not successful backlog drainage. Of the 80 unrelated containers initially observed, 75 remained at the final check with unchanged start times and no newly observed OOM; five were no longer present. Other projects were not targeted by the benchmark cleanup.

Raw operation journals, source archives, metrics, browser evidence, database dump and artifact hashes remain in ignored `.local/upload-benchmark/`; they are not uploaded GitHub artifacts. No clean three-repeat baseline, performance improvement, fault/slow-link/ramp/overload recovery, sustained resource stability or production capacity is established. The immediate missing evidence is a clean repeated run with controlled background load and complete durable drainage.
