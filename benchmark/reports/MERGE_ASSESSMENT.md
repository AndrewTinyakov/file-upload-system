Latest follow-up: [merge confidence and storage-runtime screen](CONFIDENCE_FOLLOWUP.md). The historical assessment below uses its own frozen protocol.

# Image merge assessment after additional tests

My confidence that the current two-slot default should merge for the stated performance goal remains **3/10**. The initial score was also 3/10. The additional evidence changes the interpretation, not the recommendation. Its image-worker memory savings repeat, while its latency effect changes across matched experiments. This latest set does not reproduce the earlier median improvement or the large pooled image-tail regression. It also does not establish p99 improvement or resource nonregression. Neither candidate passes the unchanged evaluator.

I also tested a smaller lifetime-only candidate. It is correct at the native ownership boundary, but it did not show a useful repeatable memory or latency benefit. My confidence that it deserves a performance PR is **2/10**. These are subjective engineering readiness scores, not statistical probabilities or estimates of defect likelihood.

Original document copying and image processing are restored. No application optimization is retained. Both proposals, their exact sources and the benchmark/instrumentation diff remain local and reviewable. No commit, push, PR, CI or merge occurred. Benchmark services and volumes are shut down.

## What would support merging

No finite benchmark can tell us for sure. For a strong merge recommendation under the agreed goal, I would need repeatable useful p99 and resource improvements, all required latency/outcome/throughput/resource guards passing, and enough samples within each protected cohort. The current rule requires 1,000 successes per exact fixture cohort; the largest cohort in any new arm has 349. Mixed service counters also cannot establish per-cohort resource safety.

A surviving worker change would then need matched fault/retry/cancellation/restart, ramp/overload recovery and short-soak confirmation, plus output integrity and image-quality checks. A per-process limit would still need deployment-specific validation before making a multi-node Kubernetes claim. These extra confirmation runs were not launched because neither candidate survived screening. Repeating this same noisy mixed screen indefinitely would not close those gaps.

## Frozen experiment

The user reopened the assessment and explicitly authorized extra tests and focused adaptation. The fixed experiment used three original, three native2 and three lifetime-only runs. Seed 276198 selected the initial order, then a cyclic rotation put every arm in each of the three positions once:

1. Block 1: lifetime, native2, original.
2. Block 2: native2, original, lifetime.
3. Block 3: original, lifetime, native2.

Each used the existing synthetic seeded mix, 120 seconds at 8 open-loop offers/s, a 12-second warmup, fresh project volumes, fixed CPU/memory/replicas, four Chromium pages, 128 inflight operations, existing deadlines and drainage. Original document staging-to-final copying, storage settings, client, API and messaging were identical across arms. Actual client upload logic ran in Chromium and successful document bytes and representative image outputs were verified. Workload assumptions remain synthetic, not estimates of production traffic. Source archives isolate the declared arm files. No tests, builds, reviews or rendering competed with measured load.

The only benchmark instrumentation change saves timestamps and counters already present in Docker stats responses: `statsReadMs`, `statsPreReadMs`, system CPU, online CPUs, CFS periods/throttled periods and major faults. It does not alter scheduling or the evaluator. All nine runs have fresh baselines under this instrumentation. Old results were not pooled into this comparison or used to widen its allowances.

Protocol `fd9299452a8fc4759311834ce4120fa078411dbc7054b8115a60548d21161099`, fixture `f5ec95ee30aafbdb5d5981c255010f69173a9311b3b9deef18a0381256f874ee`, environment `a13dca012b56fcb5e6844ebcb3de36db96254d5183f583ce01a4d44980067590` matched across all nine. Limits do not physically isolate the laptop's CPU, storage, memory pressure or thermal state. Host preflight snapshots are saved, but there is no continuous host-pressure/thermal series.

Native2 is the exact previously reviewed five-file candidate 11. It combines a two-slot native compute gate with earlier temporary-image release, keeping storage PUT outside the gate. Lifetime-only is candidate 12, exactly two early `image.Close()` calls after successful export, with the original deferred failure cleanup retained. It adds no gate, config, error-wrapping or cancellation change. Govips exports own their Go bytes and metadata before the close.

## Pooled distributions

Seconds from scheduled arrival, including generator lag, among successful operations. Exact nearest rank pools raw observations rather than averaging run percentiles. Each arm offered 2,880 operations; different admitted subsets limit interpretation. Every offer has one terminal record.

| Percentile | READY original | READY native2 | READY lifetime | Retrieval original | Retrieval native2 | Retrieval lifetime |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| p50 | 19.698 | 21.337 | 19.836 | 20.952 | 22.437 | 20.570 |
| p75 | 29.631 | 30.027 | 31.531 | 30.536 | 30.805 | 32.180 |
| p90 | 37.858 | 36.347 | 36.790 | 38.621 | 37.195 | 37.406 |
| p95 | 42.413 | 39.165 | 41.341 | 42.795 | 39.905 | 42.177 |
| p99 | 56.702 | 59.311 | 62.771 | 61.747 | 62.556 | 70.033 |

The native2 median is about 8% higher in this set. Its p90 and p95 are lower, while p99 is about 5% higher. Global p99 uncertainty overlaps, so neither a reliable p99 gain nor a causal p99 regression follows. This differs from the preceding experiment's improved median and worse image tails. Both experiments remain recorded; neither is discarded.

Image READY distributions are:

| Arm | Success / offered | p50 | p75 | p90 | p95 | p99 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 1054 / 1503 | 25.652 | 30.791 | 36.650 | 38.918 | 42.264 |
| native2 | 1044 / 1503 | 27.212 | 30.956 | 35.497 | 37.842 | 41.296 |
| lifetime | 1034 / 1503 | 26.180 | 31.804 | 34.500 | 37.793 | 41.307 |

The new pooled image p99 values are close. That weakens a claim that this default always worsens image tails. It does not prove equivalence. Per-run image tails and admission still vary, and the prior negative comparison remains relevant.

Pooled READY p99 marginal 95% intervals are 51.066 to 61.908 seconds for original, 52.996 to 65.416 for native2 and 53.063 to 73.103 for lifetime. Retrieval p99 intervals are 52.737 to 67.044, 54.692 to 70.712 and 53.503 to 78.179 seconds respectively. All p50/p75/p90/p95/p99 intervals, image/document/exact-cohort and stage splits are in `distributions.json`. Histograms retain 1 ms resolution. These marginal order-statistic intervals assume independence and do not account for all queue correlation or three-run host variation.

## Individual runs and resources

| Run | Success / rejected | READY p50 / p75 / p90 / p95 / p99 s | Files/s | MiB/s | CPU s/success | Image anonymous peak MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| merge-lifetime-q1 | 652 / 308 | 23.018 / 32.034 / 38.312 / 45.046 / 71.734 | 3.923 | 63.162 | 1.115 | 1964.262 |
| merge-native2-q1 | 654 / 306 | 22.628 / 29.089 / 35.703 / 39.017 / 65.416 | 4.024 | 65.585 | 1.059 | 1095.543 |
| merge-baseline-q1 | 602 / 358 | 24.329 / 38.225 / 43.392 / 46.702 / 74.972 | 3.583 | 58.524 | 1.140 | 1998.688 |
| merge-native2-q2 | 716 / 244 | 15.979 / 27.802 / 34.196 / 37.515 / 53.562 | 4.690 | 73.147 | 0.920 | 848.730 |
| merge-baseline-q2 | 704 / 256 | 14.013 / 28.169 / 35.292 / 37.499 / 54.231 | 4.395 | 69.428 | 0.990 | 1984.621 |
| merge-lifetime-q2 | 672 / 288 | 14.908 / 33.147 / 39.062 / 43.139 / 69.720 | 3.671 | 59.092 | 1.066 | 1758.898 |
| merge-baseline-q3 | 696 / 264 | 20.388 / 28.438 / 30.931 / 32.142 / 52.505 | 4.602 | 68.708 | 0.999 | 1766.070 |
| merge-lifetime-q3 | 675 / 285 | 19.916 / 30.209 / 32.958 / 34.429 / 56.683 | 4.455 | 67.440 | 1.030 | 2031.145 |
| merge-native2-q3 | 616 / 344 | 28.682 / 33.572 / 38.430 / 41.826 / 65.029 | 3.727 | 57.973 | 1.044 | 1007.039 |

| Arm | Success / offered | Total CPU s/success | Image anonymous peak range MiB | MinIO anonymous peak range MiB |
| --- | ---: | ---: | ---: | ---: |
| baseline | 2002 / 2880 | 1.038 | 1766.070 to 1998.688 | 539.516 to 565.121 |
| native2 | 1986 / 2880 | 1.004 | 848.730 to 1095.543 | 581.973 to 653.062 |
| lifetime | 1999 / 2880 | 1.070 | 1758.898 to 2031.145 | 552.934 to 569.047 |

CPU cost includes generator and infrastructure. These are weighted totals per successful upload in mixed traffic, not image-only attribution. Memory values are sampled peaks and can miss transients. Native2 consistently cuts image-worker peak memory, but MinIO's observed anonymous peaks are higher. Lifetime-only does not repeat that image-worker memory reduction. All network/storage/service counters remain in raw summaries and the extended analysis; counter deltas do not prove physical disk I/O.

The final native2 repeat completed 616 offers versus 696 for its block's original and delivered 57.973 versus 68.708 MiB/s. Its READY p95 was 41.826 versus 32.142 seconds. The first two blocks had better or similar candidate outcomes, so a blanket causal regression claim is too strong. The inconsistent tradeoff still prevents a reliable performance recommendation.

## Formal guards and accounting

All 8,640 offered operations have exactly one terminal record: 5,987 successes and 2,653 rejections. Every run drained broker queues and durable work, with zero unexpected errors, timeouts, unfinished uploads, cleanup failures or diagnostics. Rejections mean the fixed generator inflight bound prevented starting offered work. They remain counted lost work, not unexpected server exceptions.

Native2 is rejected by 21 guards, 8 global and 13 cohort. In this latest set, global p95, p99, outcome and completed files/bytes throughput guards pass under the broad measured baseline spread. Rejection is not a formal global-latency-regression result. Examples of failed guards are generator lag p99 of 627.200 ms against 165.500 ms, MinIO anonymous peak 653.0625 MiB against the 590.7265625 MiB allowance, and the multipart-above-boundary cohort's lost-offer fraction 35.714% against 33.333%. Other failures include small service/cached-storage counters, whose attribution is uncertain; they are not treated as proof that image code caused every change.

Lifetime is rejected by 22 guards, 13 global and 9 cohort, including image CPU cost, storage counters and multipart-boundary completed throughput. Its global latency guards also pass under baseline spread. No CPU/network/storage cost gain exceeds baseline variation, and the sample memory ranges do not demonstrate its intended benefit.

Neither arm establishes global p99 improvement beyond spread and uncertainty. Neither has sufficient exact-cohort samples or isolated resource attribution. No acceptance rule was loosened, added or removed. The scores above incorporate the useful memory result and these unresolved concerns rather than simply counting every tiny guard failure equally.

## Storage interruption and quota diagnostic

The old candidate q2 interruption remains unexplained. Its saved Docker receipt timestamps could not distinguish stale statistics from real inactivity. The new diagnostic fields narrow that ambiguity for the new final native2 run: READY completions have a 6.762-second gap from +25.113 to +31.876 seconds. MinIO reports a 5.967797 CPU-second jump across 1.830 seconds of Docker read timestamps, then almost no CPU progress for several seconds. Sample timestamps at the jump are only 74 ms old and subsequent samples are a few milliseconds old. A multi-second stale response does not explain that specific pattern, but delayed counter accounting, quota/runtime behavior, I/O or shared-host interference remain unresolved. This does not establish that the candidate is innocent or that it caused the event.

After all comparative load, a separate 15-second CPU-quota diagnostic ran four CPU-bound hash processes in a 1-CPU, 128-MiB container with no network. Across 14.071 sampled seconds it recorded 14.157311 CPU seconds, with adjacent rates 0.993 to 1.069 CPU seconds/s and no OOM. It did not reproduce the MinIO pattern and does not prove that the VM or CPU quota mechanism is generally broken. No MinIO function or host mechanism was isolated, and no causal flame-graph claim is made. The raw diagnostic and samples are preserved.

Grafana health and dashboard discovery and Prometheus target status were inspected through their APIs after measured load. Each run also retains its Prometheus range series. These observations establish monitoring availability, not a causal explanation of the stall.

## Checks, restoration and stopping

The new lifetime test failed on original code with two open native references during a storage write where only the source should remain. The two-line candidate passes that test, config/image/cmd checks and the image race detector. It decodes the actual stored WebP, JPEG and PNG bytes after processing. Existing image tests and every Docker build also ran. Both independent correctness and simplicity reviewers found no blocking issues in the exact lifetime and sampler snapshots. Native2 is unchanged from its previously reviewed snapshot and matching race checks. Benchmark drainage/evaluator/storage-settings checks passed 19 tests.

The fixed nine-run experiment is complete. Neither candidate survived the unchanged screening guards, so no further confirmation or speculative candidate was scheduled. The total candidate count is 12 of 15; this follow-up added only lifetime candidate 12 and remeasured native2 candidate 11. This is a ceiling, not a reason to use the remaining budget on a noisy screen. The original comprehensive performance objective remains unachieved.

Both application candidates were restored. All 57 original path expectations and the starting staged index match, including unrelated staged/deleted files. Services and project volumes are shut down; the diagnostic container was removed. The final handoff keeps the requested full-stop workflow scoped to a local diff, with no publication.

Artifacts in `.local/upload-benchmark/merge-assessment/` include `plan.json`, source snapshots and both proposal patches, nine run logs and exit records, `fixed-runs-complete.json`, both formal comparisons, `distributions.json`, `analyze.mjs`, red/green/race/check logs, both reviews and `review-ledger.json`, quota diagnostic/raw samples, monitoring inspection, final services/database snapshot, shutdown and restoration records. The historical noise audit is `architecture-rounds/merge-assessment-noise-audit.md`. Raw run directories, archives, Compose files and source patches are beside them under `.local/upload-benchmark/merge-*-q*`.

The final independent evidence audit found no material findings. It recomputed raw distributions, intervals, accounting, resources and guards, checked all nine source archives and restoration, and confirmed the limits of the interruption diagnosis. Its report is `merge-assessment/evidence-audit.md`. The interactive comparison is `merge-assessment/comparison.html`.
