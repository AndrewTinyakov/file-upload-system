# Image concurrency with document copying retained

My recommendation is to keep document copying and leave the current two-slot image implementation out of a production optimization PR. Bounded concurrency is a normal resource-control technique, but this implementation and default made memory lower at the cost of worse high-percentile image latency. The independent comparison does not support enabling it by default. The previous validated application code is restored.

## What was tested

The user explicitly reopened one focused comparison after the prior stopping decision. Candidate 11 uses the five files pinned by `native2-manifest.json`. It adds a shared native copy/resize/export gate, defaults its capacity to Go's CPU budget, and closes temporary native images before S3 PUT. Storage PUTs stay outside the gate. Both semaphore admission and shorter image lifetime may affect the result; they were measured together. Decode/source-payload retention remains outside the gate.

The original document staging-to-final copy, client, API, storage settings and messaging behavior were identical on both arms. There was no direct-to-versioned-document change in these trials. The common versioned document bucket fixtures stayed present on both arms to preserve the frozen benchmark, but the application used the original copy flow.

Three fresh controls were interleaved with three two-slot candidate trials. Every run used the existing synthetic seeded mix, a 120-second open-loop arrival window at eight offers per second, a 12-second warmup, fresh volumes, fixed service CPU/memory, replicas, generator placement, four browser pages, a 128-operation inflight bound, deadlines and drainage rules. Startup confirmed native_concurrency=2 and gomaxprocs=2 for the candidate, with worker4, variants2 and VIPS2 unchanged.

Protocol `e432a95b2b03636204a65b28592eb20d1936aebea925245e78482e4e156de705`, fixture `f5ec95ee30aafbdb5d5981c255010f69173a9311b3b9deef18a0381256f874ee` and environment `a13dca012b56fcb5e6844ebcb3de36db96254d5183f583ce01a4d44980067590` matched across all six runs. Neither instrumentation nor acceptance changed. Earlier controls were not added to widen allowances. Tests, builds, reviews and rendering did not compete with measured load.

## Full pooled latency distribution

Seconds from scheduled arrival, including generator lag, conditional on successful completion. Quantiles use exact nearest rank over pooled raw observations, rather than averaging per-run percentiles. Each side offered 2,880 operations. The original completed 2,250 and rejected 630; the candidate completed 2,238 and rejected 642. Their admitted workload subsets therefore differ.

| Percentile | READY original | READY two-slot | Retrieval original | Retrieval two-slot |
| --- | ---: | ---: | ---: | ---: |
| p50 | 15.201 | 12.039 | 15.864 | 12.587 |
| p75 | 27.895 | 25.980 | 28.434 | 26.590 |
| p90 | 31.754 | 37.243 | 32.523 | 37.979 |
| p95 | 33.532 | 42.683 | 34.490 | 44.036 |
| p99 | 44.908 | 48.220 | 47.901 | 49.456 |

Typical latency improved, but the tail worsened. READY p50 improved by about 21%, while p90 worsened by about 17%, p95 by about 27% and p99 by about 7%. These are observed point estimates. They do not establish a universally beneficial setting.

## Images and documents separately

| Group / version | Success / offered | READY p50 | p75 | p90 | p95 | p99 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| images / baseline | 1173 / 1503 | 24.725 | 30.015 | 32.806 | 34.100 | 35.558 |
| images / native2 | 1192 / 1503 | 19.371 | 32.030 | 40.458 | 44.545 | 48.395 |
| documents / baseline | 1077 / 1377 | 9.802 | 18.502 | 26.702 | 31.582 | 54.762 |
| documents / native2 | 1046 / 1377 | 6.972 | 14.707 | 23.586 | 30.130 | 48.220 |

Image READY p99 worsened from 35.558 to 48.395 seconds, despite an improved median. This is a material image-tail tradeoff, not solely a small monitoring-counter failure. Preparation stage observations include queue, compute and storage time; native semaphore wait was not separately instrumented. The data does not prove which part of the implementation or host variability caused the bad repeat.

## Individual runs and resources

| Run | Success / reject | READY p50 / p75 / p90 / p95 / p99 s | Retrieval p99 s | Files/s | MiB/s | CPU s/success | Image anonymous peak MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| image-only-baseline-q1 | 700 / 260 | 18.43 / 29.97 / 33.84 / 35.22 / 54.26 | 56.338 | 4.361 | 69.351 | 0.996 | 1970.7 |
| image-only-native2-q1 | 822 / 138 | 11.62 / 22.67 / 28.37 / 30.52 / 41.74 | 46.283 | 5.325 | 81.593 | 0.847 | 1125.6 |
| image-only-baseline-q2 | 760 / 200 | 14.97 / 25.79 / 31.59 / 33.24 / 45.40 | 50.996 | 4.783 | 74.641 | 0.904 | 1891.2 |
| image-only-native2-q2 | 550 / 410 | 25.07 / 40.05 / 45.22 / 46.69 / 59.24 | 60.468 | 3.780 | 54.247 | 0.993 | 1033.6 |
| image-only-baseline-q3 | 790 / 170 | 13.00 / 26.92 / 29.98 / 30.91 / 36.21 | 38.297 | 5.441 | 78.851 | 0.860 | 1890.9 |
| image-only-native2-q3 | 866 / 94 | 7.91 / 18.40 / 33.85 / 36.56 / 38.79 | 45.335 | 5.670 | 86.429 | 0.809 | 1063.2 |

Weighted total CPU per successful upload decreased from 0.917 to 0.868 seconds. Image-worker anonymous peaks were 1,890.9 to 1,970.7 MiB originally and 1,033.6 to 1,125.6 MiB with the candidate. That repeated memory benefit is real within these samples, but it was not accompanied by reliable latency or completed-throughput nonregression.

The first pair improved every reported latency percentile and completed 822 versus 700 offers. The second candidate completed only 550 versus 760, with READY p95 of 46.686 versus 33.236 seconds. It delivered 54.247 MiB/s versus 74.641 MiB/s. The third candidate completed 866 versus 790, but its p95 was still higher than its control. All repeats remain included. The raw resource report contains CPU, sampled memory, network and storage bytes for every service; mixed counters do not attribute resources safely to each cohort.

## Correctness, evaluation and uncertainty

All 5,760 offered operations have exactly one terminal record. Every run drained broker queues and durable work, with zero unexpected errors, timeouts, unfinished uploads, cleanup failures or diagnostics. Rejected offers reached the fixed generator inflight limit and count as lost offered work. The evaluator's errorFraction includes these rejections; it does not imply unexpected server exceptions. The actual uploader ran in Chromium, and retrieved document bytes and representative image outputs were verified.

The unchanged evaluator rejects global READY and retrieval p95, rejected-offer fraction, completed-byte throughput, generator lag, service resource and multiple cohort guards. The candidate's worst READY p95 of 46.686 seconds exceeded the frozen 39.535-second allowance. The worst byte throughput of 54.247 MiB/s was below the allowed floor of about 59.851 MiB/s. No thresholds were relaxed.

Pooled READY p99: original 44.908 seconds, marginal 95% interval 36.529 to 54.014; candidate 48.220 seconds, marginal 95% interval 47.059 to 49.063.
Pooled verified retrieval p99: original 47.901 seconds, marginal 95% interval 38.297 to 56.338; candidate 49.456 seconds, marginal 95% interval 48.224 to 50.327.

All p50/p75/p90/p95/p99 marginal 95% order-statistic intervals, per-run values, image/document splits, exact fixture cohorts and stage distributions are in `native2-only-distributions.json`. Histograms retain the frozen 1 ms resolution. Marginal intervals do not account for all queue correlation. Baseline variation remains substantial, and this local mixed workload is synthetic. Global p99 did not satisfy the formal improvement rule; every exact fixture cohort remains below the required 1,000 successes. No rare-cohort resource-safety or multi-node Kubernetes capacity claim is supported.

The focused config/image/cmd checks passed again on the exact reviewed five-file snapshot. Prior matching config/image race and both correctness/simplicity reviews remain valid. No new implementation edit was made for this experiment. Because the candidate failed screening, no new independent candidate browser/fault/slow-link/ramp/soak confirmation was launched. This is a rejected performance proposal, not a feature readiness declaration.

## Honest PR recommendation and handoff

I would not create a production optimization PR enabling this exact two-slot default. It is not a benchmark hack: limiting expensive operations and releasing native images before I/O are ordinary techniques. The problem is the measured tradeoff. The current implementation improves median latency and memory but worsens higher image percentiles, with a substantial poor-run throughput loss. An investigation of image lifetime separately from gate capacity could be worthwhile later, but was not performed and has no claimed benefit.

Per-process limits also remain per process in Kubernetes. Replicas have independent gates; there is no cluster-wide image or storage limit. Appropriate CPU/memory requests and limits, native-library threading and workload dimensions would need deployment-specific testing. This one-worker local experiment does not prove horizontal scaling or slow-client improvements.

This follow-up stops after the one candidate the user explicitly requested. Candidate count is now eleven of fifteen across the full history. The previous stopping decision was reopened only for this comparison. Original image processing and document copying are restored; no application optimization is retained. The benchmark/instrumentation local diff and the rejected five-file proposal remain reviewable. No commit, push, PR, CI or merge was made.

The benchmark services and volumes are shut down. Restoration checked all 57 original-path expectations and preserved the unrelated starting index. Raw results, source archives, logs, database snapshot and storage captures remain local.

Artifacts in `.local/upload-benchmark/architecture-rounds/`:

- `native2-only-plan.json`, `native2-only-fixed-runs-complete.json` and six uniquely labeled run directories pin the experiment.
- `native2-only-comparison.json` contains every frozen guard and distribution.
- `native2-only-distributions.json` contains the extended percentile, stage, cohort and resource analysis.
- `native2-only-completed-progress.json` contains all six compact run rows.
- `native2-only-focused-check.log`, `native2-race-check.log` and the earlier two focused review reports cover the unchanged candidate.
- `candidate11-image-limit-against-head.patch` is the archived rejected five-file proposal.
- `native2-only-final-restoration.json`, `native2-only-final-services.log`, `native2-only-final-database.dump`, `native2-only-final-shutdown.log`, `native2-only-final-containers.jsonl` and `native2-only-final-volumes.jsonl` record restoration and shutdown.

The final independent evidence audit found no material numerical errors or unsupported adoption claims. It recomputed raw quantiles and intervals, checked outcome accounting and resource costs, compared all six source archives, and verified restoration and the original staged index. See `architecture-rounds/image-only-evidence-audit.md`. The interactive percentile comparison is `architecture-rounds/native2-only-comparison.html`.
