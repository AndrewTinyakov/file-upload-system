# Merge confidence follow-up

I could not substantiate an 8/10 merge recommendation. Confidence in enabling the two-slot image compute default remains 3/10, based on its earlier matched measurements. This follow-up tests a different storage setting, not the image gate, and does not change that score. The MinIO runtime setting is also not recommended for adoption after its failed screen. Original application processing and document staging-to-final copying remain in place. Only benchmark provenance and its regression checks were added in this follow-up.

The new hypothesis was specific: MinIO reported 11 Go runtime processors despite a fixed one-CPU quota. Reducing runtime processors to two might reduce contention without allocating more CPU or weakening storage integrity. Source at the pinned release and `mc admin info` confirm Go 1.24.6 and the effective 11/2 settings. This establishes a configuration mismatch worth testing, not the cause of the previously observed stalls. Two sequential 64 MiB copy diagnostics per setting looked promising, but were not fresh-state end-to-end comparisons and did not determine adoption.

## Frozen screen and decision

Candidate 13 used the existing seeded synthetic weighted fixtures, actual Chromium uploader, four pages, 128-inflight limit, 120-second arrivals at eight offers/s, 12-second warmup, fresh volumes, fixed quotas and one replica per service. Documents and image outputs were verified as before. Compression remained off and the document copy remained enabled. Arrivals were independent of completion; every offer was accounted.

Three fresh controls preceded the candidate. This fixed order is an unbalanced screening design, not evidence against time-related drift. The plan predeclared early rejection if the first candidate failed any existing guard. It failed 13 guards, so the remaining two candidate repeats and longer confirmation were skipped. Adding repeats cannot erase a recorded failure under this evaluator's worst-run rule. No result was dropped or rerun selectively. Fresh controls were necessary because runtime provenance instrumentation changed. Numerical acceptance, workload, resources, replicas and durations stayed fixed.

Protocol `00b1ba2a7f2167dd1a9d1341dbd42518802d79ab79b5159f0e17761ed378bb83`, fixture `f5ec95ee30aafbdb5d5981c255010f69173a9311b3b9deef18a0381256f874ee` and environment `fcd0240c3215f3261e6e585d344db5546f38d241773f2972335569ad8978480d` match across all four runs. Historical protocols are not pooled or used for allowance.

## Latency and costs

Seconds from scheduled arrival, including generator lag, among successes. Baseline pools three runs and the candidate has one screen. Different admitted subsets and queue correlation limit causal interpretation. These are exact nearest-rank observations, not averages of run percentiles.

| Percentile | READY original | READY runtime2 | Retrieval original | Retrieval runtime2 |
| --- | ---: | ---: | ---: | ---: |
| p50 | 15.815 | 9.717 | 16.562 | 10.561 |
| p75 | 30.100 | 32.666 | 30.808 | 33.835 |
| p90 | 37.045 | 40.472 | 37.863 | 41.179 |
| p95 | 39.289 | 42.456 | 40.405 | 43.214 |
| p99 | 46.320 | 44.810 | 49.892 | 46.778 |

The candidate median is lower, while its p75, p90 and p95 are higher. READY p99 marginal 95% intervals are 43.213 to 55.984 seconds for the controls and 44.209 to 50.374 for the candidate. Retrieval intervals are 45.188 to 58.368 and 45.483 to 56.332 seconds. They overlap. Histograms retain 1 ms resolution; percentiles use raw unrounded observations. These intervals assume independent observations and omit host drift and queue correlation.

| Run | Successful / rejected | READY p99 s | Completed files/s | Completed MiB/s | Total CPU s/success |
| --- | ---: | ---: | ---: | ---: | ---: |
| confidence-baseline-r1 | 638 / 322 | 59.755 | 3.923 | 63.474 | 1.115 |
| confidence-baseline-r2 | 758 / 202 | 42.315 | 4.952 | 70.998 | 0.967 |
| confidence-baseline-r3 | 725 / 235 | 47.639 | 4.713 | 73.539 | 0.939 |
| confidence-runtime2-r1 | 755 / 205 | 44.810 | 4.863 | 71.102 | 0.962 |

Control p99 spans 42.315 to 59.755 seconds with unchanged code. Total CPU/success spans 0.939 to 1.115; the candidate is 0.962, within that range. Weighted baseline CPU/success is 1.002. Candidate MinIO CPU/success is 0.178 versus weighted baseline 0.210, but this does not exceed repeat variability. MinIO anonymous peak is 502.996 MiB versus control range 518.953 to 564.676 MiB. Neither number is a repeatable supported deployment benefit after one candidate run.

Across services, baseline/candidate summed network RX is 33.602/32.171 MiB per success, TX 33.510/32.084, storage reads 27.786/23.832 and writes 31.436/30.470. They include client verification, cleanup, infrastructure and different admitted bytes. Full per-service and per-successful-byte data are in `distributions.json`. Only MinIO storage-read bytes per successful byte clears the evaluator's cost-improvement condition. Cached/writeback counters cannot establish equivalent physical disk savings. Global latency and throughput guards pass under the broad baseline allowance; passing is not proof of equality or improvement.

The 13 failed guards include generator lag p95 of 60.0 ms against a 41.200 ms allowance, API anonymous peak of 406.453 MiB against 402.602 MiB, small-JPEG READY p99 of 44.284 seconds against 44.047, and large-document lost-offer fraction of 38.889% against 33.333%. Eight failures concern cohort generator lag. These are observed threshold failures, not proof that this setting caused every difference. Global p99 improvement does not exceed spread and disjoint uncertainty intervals.

All 3,840 offers have terminal records: 2,876 successes and 964 generator in-flight-limit rejections. There are zero unexpected errors, timeouts, unfinished uploads, cleanup failures or diagnostics. All queues and durable work drained. Rejections are lost offered operations, not HTTP error responses. The largest exact fixture cohort has 373 control successes and 139 candidate successes, below the required 1,000. Mixed resources also cannot establish isolated cohort safety.

Preparing remains the largest measured tail stage: its p99 is 40.921 seconds in pooled controls and 43.586 in the candidate. Uploading p99 is 24.424 and 14.115. Stage quantiles are not additive and cannot establish exclusive service time. The candidate still has a 3.400-second READY completion gap and a sampled MinIO CPU-rate anomaly. Thus the earlier interruption mechanism remains unresolved; fewer runtime processors did not establish its removal. Existing storage CPU profiling is dominated by hashing and system calls, not proof of scheduler contention.

## What changed and verification

Benchmark storage snapshots now capture effective GOMAXPROCS, visible CPUs and Go version through MinIO's admin report, before and after load. The declared trial allows empty GOMAXPROCS for the original host-derived setting or `BENCHMARK_MINIO_GOMAXPROCS=2`. Default behavior remains host-derived. Missing or drifting provenance, mixed modes within one comparison side and fixed CPU/version drift across sides reject comparison. Compression provenance remains enforced. This extension is scoped to the user-authorized storage-setting trials.

The initial runtime test failed before the resolver existed. Independent correctness review then found a comparison defect, RUNTIME-01, allowing otherwise valid runs with mixed runtime settings. A red test reproduced it. Direct side/fixed-provenance checks fixed it; focused independent recheck passed. Standards/simplicity review found no substantive issue. All 25 focused benchmark tests pass, including a deliberately slower synthetic candidate that must fail the numerical latency guards. Three unchanged browser-behavior tests also pass in the generator image. An initial host all-tests invocation lacked esbuild, so browser tests were run in Docker instead. Build preflight passed. This is not a newly measured real-system slow positive control; earlier real positive controls remain historical evidence.

Grafana health/dashboard discovery and Prometheus targets were inspected after load. Every run retains Prometheus range series. A linked Linux host was checked read-only and is unsuitable for the frozen deployment: four CPUs, 7.75 GiB RAM and 5.1 GiB free disk. Its other workloads were preserved. Moving there would require changing limits or adding infrastructure, so it was not used.

No survivor received new slow-link/fault/restart/ramp/overload/soak confirmation or powered isolated cohorts. Running those after rejection would not change the adoption decision. Existing historical evidence remains available, with its protocol boundaries.

## Stopping and merge recommendation

Stop after candidate 13. Candidates 9 through 13 are five consecutive unsuccessful ideas spanning the broader document data-flow investigation, combined image/storage changes, independent native gating, native lifetime release and storage runtime tuning. Fifteen is the maximum, not a requirement to spend the last two ideas on unsupported guesses. Repeated image experiments and this new storage experiment still provide no validated performance survivor under the agreed protected outcomes.

An 8/10 recommendation would require a useful repeatable improvement, successful nonregression screening, powered cohort/resource evidence and relevant recovery/slow-link/deployment confirmation. We do not have that. Raising the score would conceal the missing evidence. A 10/10 recommendation is unattainable from finite local tests: production distributions, storage behavior, multi-node scheduling and rare failures remain uncertain even after a strong validation campaign. These scores describe engineering readiness, not statistical probabilities.

The performance objective was not achieved. This does not show that the stack cannot be improved. It shows the tested proposals have not earned adoption with the available evidence. Preserve original application behavior, the useful benchmark/instrumentation work and all rejected proposals as local artifacts. No commit, push, PR, CI or merge occurred. Services and project volumes were shut down after saving logs and a database snapshot. The full-stop workflow remains scoped to the local reviewable diff.

Reproduce the screen with `python3 -u .local/upload-benchmark/confidence-investigation/run.py` only after selecting unused labels in a new frozen plan. Reproduce analysis with `node .local/upload-benchmark/confidence-investigation/analyze.mjs`. Raw runs, source archives, exact Compose configs, offered/dispatch/terminal journals and settings are under `.local/upload-benchmark/confidence-*`. The plan, red/green logs, formal comparison, extended distributions, review ledger, monitoring, shutdown and restoration records are in `.local/upload-benchmark/confidence-investigation/`.
