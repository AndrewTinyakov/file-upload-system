# Architecture follow-up: final result

The optimization objective was not achieved under the frozen acceptance rules. All ten measured candidate ideas are preserved in the ledger. Original application behavior is restored, compression is off, and the local diff retains the benchmark and bounded observations. No commit, push, PR, CI or merge occurred.

The experiments did find useful improvements. Immutable documents removed a storage payload copy and improved completed throughput. A two-slot shared image compute gate roughly halved image memory without the one-slot setting's consistent p95 penalty. The combined candidate still failed operation-level and resource guards, so these proposals are archived rather than adopted.

## Comparison boundaries

The first architecture plan ran three interleaved controls and three repeats of each independent candidate: client four-PUT bound, native compute capacity one, and immutable documents. All twelve runs completed before the user requested a pause. On resume, a new fixed plan ran three fresh controls interleaved with three immutable-plus-capacity-two trials. The earlier controls do not enlarge this later comparison's thresholds.

Both plans use protocol `e432a95b2b03636204a65b28592eb20d1936aebea925245e78482e4e156de705`, fixture `f5ec95ee30aafbdb5d5981c255010f69173a9311b3b9deef18a0381256f874ee` and environment `a13dca012b56fcb5e6844ebcb3de36db96254d5183f583ce01a4d44980067590`. Workload and evaluator were unchanged. The excluded policy-array-ordering attempt remains archived and excluded. Fresh controls were required for instrumentation changes and again prospectively after the laptop pause.

Every quick run offered 960 uploads independently of completion over 120 seconds at eight per second, with a 12-second seeded warmup, fresh volumes, fixed service limits, one replica per service, four browser pages and a 128-operation inflight limit. Source changes and builds happened only between completed runs. Tests, reviews, profiles and rendering did not compete with measured load. The seeded fixture mix is synthetic and covers documents, JPEG/PNG/WebP, dimensions, compressibility, repeated bytes, single PUT, multipart boundary sizes and 256 MiB files.

## Final focused candidate

| Run | Success / offers | Rejected | READY p95 / p99 s | Retrieval p99 s | Files/s | MiB/s | CPU s/success | Image anonymous peak MiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| resume-baseline-q1 | 634 / 960 | 326 | 41.259 / 63.744 | 69.133 | 3.762 | 61.651 | 1.176 | 1855.3 |
| resume-immutable-native2-q1 | 910 / 960 | 50 | 25.322 / 30.186 | 34.848 | 6.402 | 95.478 | 0.816 | 970.7 |
| resume-baseline-q2 | 723 / 960 | 237 | 33.147 / 38.387 | 39.917 | 5.050 | 71.987 | 0.947 | 1929.7 |
| resume-immutable-native2-q2 | 727 / 960 | 233 | 37.079 / 42.052 | 63.916 | 4.807 | 74.868 | 1.048 | 1033.3 |
| resume-baseline-q3 | 757 / 960 | 203 | 33.156 / 41.448 | 48.120 | 4.921 | 73.397 | 0.938 | 1900.3 |
| resume-immutable-native2-q3 | 960 / 960 | 0 | 18.788 / 20.343 | 20.833 | 7.003 | 106.232 | 0.701 | 1009.6 |

The controls completed 2,114 of 2,880 offers; the candidate completed 2,597, a 22.8% increase in completed count. Pooled READY p99 was 50.453 seconds versus 39.093. Weighted total CPU per successful upload was 1.012 versus 0.838 seconds. These point estimates are useful, but do not override the failed guards.

All six runs accounted for every offer, drained queues and durable work, and reported zero unexpected errors, timeouts, unfinished uploads, cleanup failures or diagnostics. Rejections hit the fixed generator inflight limit. The evaluator's errorFraction includes these lost offers; a failed outcome guard does not imply an unexpected server exception. Latency is conditional on success, starts at scheduled arrival and includes generator lag. Completed throughput includes terminal drainage time.

## Why it was rejected

The unchanged evaluator rejected global generator lag, generator receive bytes per successful byte, API anonymous memory and API storage-read cost. It also rejected some cohort generator-lag guards, PNG retrieval p95 and noise-PNG outcomes/completed throughput. These are recorded results, not all proven application defects.

Examples from the final comparison: global generator-lag p99 was 409.200 ms at worst against a 290.200 ms limit. API anonymous memory was 408.652 MiB at worst against a 403.723 MiB limit. Noise-PNG worst completed throughput was 0.359 files/s against a 0.377 files/s floor. Its failed outcome guard came from rejected offers. Alpha-PNG worst retrieval p95 was 45.674 seconds against a 44.797-second limit. No guard was waived.

READY p99 has a marginal 95% interval of 45.003 to 56.483 seconds in controls and 37.081 to 39.841 seconds in the candidate. Retrieval p99 was 53.267 seconds, interval 48.120 to 61.549, versus 46.612 seconds, interval 44.097 to 49.638. The formal improvement test additionally requires separation beyond the baseline run spread: 25.357 seconds for READY and 29.216 seconds for retrieval. It did not pass. Exact unrounded nearest-rank quantiles are retained, with 1 ms histogram bins. Correlated queue observations can make uncertainty wider than the marginal intervals.

All fixture cohorts remain below the required 1,000 successes, and mixed service counters cannot prove cohort resource safety. Isolated cohort resources, rare-event reliability and production-long retention/expiration remain unverified. No evaluator or protocol acceptance change was made.

## Previous three candidates and diagnosis

The bounded cancellable client passed eleven actual-uploader tests and typechecks, and outstanding PUTs stayed at four per page. Its three runs completed 2,024 offers against 2,146 controls and failed tail/resource/cohort guards. It is restored. Cancellation stops client work; the server abort remains the caller's responsibility.

The one-slot native gate passed focused and race checks and cut anonymous image memory to 758.5 to 933.4 MiB, but image p95 worsened. Archived samples show only 1.107 to 1.124 CPU cores used during the offered window against a two-core budget. This justified the next two-slot trial.

Immutable documents completed 2,878 of 2,880 offers against 2,146 original-control successes. Their READY p99 was 29.774 to 33.211 seconds against 42.554 to 55.050 seconds, and total CPU per success was 0.698 to 0.727 seconds against 0.886 to 1.172. That candidate failed image-worker I/O, API/Postgres memory/storage and some generator-lag guards, plus the formal tail criterion. It is restored.

Immutable image disk writes began as the worker approached its 2 GiB limit. More than 99.8% of writes in the two affected runs coincided with near-limit memory intervals. This supports memory pressure as a cause, but does not prove swap or libvips spill. Swap, PSI, page-fault, syscall and per-file counters were not archived. The demonstrated shift is from document-copy storage work toward image CPU, with more images admitted. The two-slot trial kept image anonymous peaks at 970.7 to 1033.3 MiB; source snapshots and startup logs confirm native_concurrency=2 and gomaxprocs=2.

Storage checksums/copying, image encoding, generator/browser work and variable host conditions remain bottlenecks. Earlier CPU/allocation flame graphs and compression measurements are linked in REPORT.md. Compression remains off. No further profiler was run concurrently with measurement or to invent a cause for host variability.

## Integrity, reviews and user behavior

The immutable proposal uses a dedicated versioned documents bucket and pins the persisted source version through verification, retention tagging and retrieval. It preserves legacy staging for existing rows and images. Real-storage tests covered exact retrieval, replay, lost completion responses and deletion/recreation races. The V3 migration, regenerated contracts and typed jOOQ model passed their recorded API, repository, publisher and storage checks. The pinned MinIO ignores lifecycle AbortIncompleteMultipartUpload; the proposal relies on explicit abort/expiry and the existing server stale-multipart cleanup settings. Elapsed production-duration cleanup was not verified. Documents use publicEndpoint rather than the assets-only CDN base, an operational routing requirement for adoption.

The native gate bounds native copy/resize/export, releases its permit and temporary image before S3 PUT, and preserves encoder settings and exact benchmark image hashes. Capacity-two config/image/cmd tests and config/image race tests passed. Both focused correctness and simplicity rechecks found no blockers. Prior independent reviews cover the unchanged native processor and immutable paths. The final app state matches all 57 original source-path expectations, including absence of newly introduced candidate-only files. The unrelated starting index is preserved.

The actual production upload function ran in Chromium in every measured trial, and every successful retrieval was verified. This establishes those synthetic flows, not independent user verification of a retained candidate. Since no candidate survived the guards, no new candidate React/fault/slow-link/ramp/soak confirmation matrix was launched. Previous original-code UI, network, fault, ramp, overload, monitoring and five-minute growth evidence remains in REPORT.md. Those runs do not establish a speedup for these new proposals. Current source restoration permits reuse for unchanged paths; new candidate user flows and lifecycle-duration behavior remain unverified.

## Stopping and artifacts

Iteration stopped after five consecutive unsuccessful candidate rounds following the broader websocket and architecture investigation: notification wakeups, client PUT bound, one-slot native gate, immutable documents, and immutable plus two-slot native gate. Ten of the fifteen candidate ideas were measured across the complete history. The ceiling was not exhausted. The requested p99/resource objective remains unachieved under the frozen rules.

Full-stop is applied within the local-diff-only authorization. The previous validated implementation is restored, and the retained benchmark/instrumentation diff is reviewable. No candidate is represented as performance-ready. The services' logs and database dump are saved, and project containers and volumes are removed. No campaign is active or scheduled.

Artifacts under `.local/upload-benchmark/architecture-rounds/`:

- `plan.json`, `freeze.json`, `resume-plan.json` pin conditions, order and acceptance.
- `completed-progress.json` and `resume-completed-progress.json` contain every completed row.
- `client-comparison.json`, `native-comparison.json`, `immutable-comparison.json` and `resume-comparison.json` contain exact distributions, intervals, outcomes and every guard.
- `resume-resource-costs.json` contains service resource comparisons and guard magnitudes.
- `resumed-resource-investigation.json` contains per-run CPU, disk timing, stages and cohort diagnosis.
- `review-ledger.json`, `native2-focused-check.log`, `native2-race-check.log` and focused review reports record correctness evidence.
- `candidate10-against-head.patch` is an archived rejected application proposal for review against HEAD, with its full 57-path source manifest in `immutable-native2-manifest.json`. It is not the retained diff.
- `final-restoration.json`, `final-services.log`, `final-database.dump`, `final-shutdown.log`, `final-containers.jsonl` and `final-volumes.jsonl` record restoration and shutdown.

The current task diff is exported separately as `.local/upload-benchmark/final-task.patch`. Candidate snapshots, raw run directories, source archives, storage captures, bounded traces and previous evidence remain local. Reopening the laptop does not invalidate completed runs. A later experiment should address a named failed guard with fresh labels, rather than rerun the old campaign or silently loosen acceptance.
