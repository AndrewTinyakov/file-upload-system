Latest follow-up: [merge confidence and storage-runtime screen](CONFIDENCE_FOLLOWUP.md). The historical assessment below uses its own frozen protocol.

# Latest merge assessment

The [additional image merge assessment](MERGE_ASSESSMENT.md) completed nine fresh balanced runs of the original, the two-slot proposal and a smaller lifetime-only change. Merge confidence remains 3/10 for the two-slot default. Its memory savings repeat, but latency benefits do not; the smaller change did not show a useful memory benefit. Both fail the unchanged guards and remain archived proposals. Original image processing and document copying are restored, services are stopped, and no PR or CI run was created. Twelve of the fifteen candidate ideas have been measured. The earlier independent and combined experiments remain below.

# Previous independent comparison

The [independent image-concurrency follow-up](IMAGE_CONCURRENCY_FOLLOWUP.md) tested the two-slot image implementation while retaining original document copying. Three fresh controls and three candidate runs completed. Median latency and image memory improved, but high-percentile image latency and poor-run throughput regressed, so the candidate is restored and is not recommended as an enabled production default. Eleven candidate ideas have been measured across the full history. All evidence is saved, containers and volumes are stopped, and no PR or CI run was created. The previous [architecture follow-up](ARCHITECTURE_FOLLOWUP.md) records the combined experiments. The report below covers earlier campaigns.

# Upload optimization record

The performance objective was not achieved. No application optimization passed
the frozen regression guards. Original client and worker behavior is restored;
MinIO compression is off. The retained local diff adds the repeatable benchmark,
API/worker observations and an allocation diagnostic. It makes no application
speedup claim. No commit, push, PR or merge was made.

The later [websocket follow-up](WEBSOCKET_FOLLOWUP.md) tested notification-driven
outbox dispatch. Small-document p99 and polling improved in stable runs, but
mixed high-load guards failed. That candidate is also archived and restored.
The follow-up explains both rejection meanings and proposed evaluation changes;
no acceptance rules were changed.

This report covers the shorter campaign the user approved on 2026-11-08.
[STRATEGY.md](STRATEGY.md) records its stopping rules. Historical checkpoint
claims about the laptop stop and v4 being current are superseded. Earlier runs,
interruptions and correctness evidence remain in the
[artifact inventory](../../.local/upload-benchmark/final-evidence-inventory.md) and
[candidate ledger](../../.local/upload-benchmark/candidate-ledger.json).

## Comparison boundary and method

The candidate campaign used protocol
`b9b1fa731975933a2adfcc83d38b750ca4020d613249cb6572c527c19d2081ee`,
recorded in [freeze-short-cdp-campaign.json](../../.local/upload-benchmark/freeze-short-cdp-campaign.json).
Final review made the database backlog sampler opt-in outside the benchmark,
with identical one-second observations explicitly enabled in benchmark Compose.
The new final freeze is
`23e1b53ed015ea0c76890874a59bbaed8d508acf303b0a1843410e54ecc6ee36`,
recorded in [freeze-short-current.json](../../.local/upload-benchmark/freeze-short-current.json).
Fresh original baselines use that final freeze; the campaign comparisons below
remain within their earlier matching freeze. No cross-freeze performance
comparison is made.
The mixed comparison uses fixture hash `f5ec95ee30aafbdb5d5981c255010f69173a9311b3b9deef18a0381256f874ee`
and environment hash `18245cc7539f7bda05c2a18aabdd81243ff39eda2cbde6073b7c7fac9e9b06d4`.
Historical hashes are excluded from current performance comparisons.

Production client upload code runs in Chromium. Seeded open-loop arrivals,
fresh volumes, warmup, limits, replicas, integrity checks, deadlines and drainage
guards stay fixed. Twelve synthetic fixture cohorts cover documents, JPEG,
PNG, WebP, alpha, multipart boundaries and large files. Their weights are not
production traffic estimates. Services and generator share the ARM64 OrbStack
host. Builds and unrelated checks stay idle during measurement.

The custom network proxy stalled under real concurrent browser traffic. It was
rejected and removed. Its partial runs and failure accounting remain archived,
including `screen-final-slow1/INTERRUPTED.json`; they do not enter acceptance.
Fresh baselines use Chromium CDP after fixture preparation. Independent
[single and concurrent PUT/GET checks](../../.local/upload-benchmark/cdp-network-validation.json)
verified byte integrity, latency and shared per-page aggregate bandwidth. The
[delivered check](../../.local/upload-benchmark/network-check.json) also passed.

Quantiles use exact unrounded observations and 95% order-statistic intervals;
histograms use 1 ms bins. Latency starts at scheduled arrival and includes
generator lag; actual browser-start timestamps are also preserved. Latencies
below are conditional on success. Throughput
includes time through the later of measurement end and terminal completion.
Rejected offers remain failed offered work. Marginal intervals assume independent
observations; queue correlation can make uncertainty wider. Acceptance still needs
three repeats per side, 1,000 successes in every evaluated group, improvement
beyond baseline spread and nonregression guards. Mixed global resource counters
do not establish resource nonregression for any individual cohort.

## Completed baseline and rejected candidates

Every mixed row below offered and recorded 960 operations. All rows drained,
with zero unexpected errors, timeouts, unfinished operations, cleanup failures
or diagnostics. Rejections came from the generator's fixed inflight limit.

| Run | Success | Reject | READY p99 s | Verified retrieval p99 s | Files/s | CPU s/success |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `screen-cdp-q1` | 775 | 185 | 42.286 | 44.492 | 5.262 | 0.917 |
| `screen-cdp-q2` | 846 | 114 | 41.569 | 42.698 | 5.607 | 0.880 |
| `screen-cdp-q3` | 843 | 117 | 43.460 | 43.966 | 5.277 | 0.932 |
| `screen-cdp-compression1` | 764 | 196 | 47.425 | 52.205 | 4.841 | 0.990 |
| `best-q1` | 762 | 198 | 38.538 | 41.267 | 5.050 | 0.977 |
| `best-q2` | 768 | 192 | 42.220 | 44.968 | 5.000 | 0.989 |
| `best-q3` | 798 | 162 | 38.022 | 40.260 | 5.194 | 0.959 |
| `screen-cdp-post-control1` | 658 | 302 | 55.234 | 57.842 | 4.203 | 1.119 |
| `best-client-q1` | 665 | 295 | 40.987 | 42.583 | 4.526 | 1.084 |

The original baseline accounts for all 2,880 offers: 2,464 successes and 416
rejections. Its pooled READY p99 is 42.822 s, with a 95% interval of 42.364 to
43.460 s. Retrieval p99 is 43.614 s, with an interval of 42.900 to 44.399 s.
Per-run intervals, cohort distributions, stages and service costs are in
[final-run-data.json](../../.local/upload-benchmark/final-run-data.json).

| Candidate | Decision and evidence |
| --- | --- |
| Transparent MinIO lossless compression | Rejected after one screen. READY and retrieval tails worsened; storage savings did not justify more repeats. Compression remains off. [Comparison](../../.local/upload-benchmark/compression-screen-comparison.json). |
| Remove image HEAD before conditional GET | Restored with original workers after combined rejection. Focused tests preserved metadata, source-change and replay behavior. No accepted end-to-end improvement. |
| Bounded image source allocation | Restored despite isolated savings. At 1 MiB, allocation fell from about 2.23 MB and 35 allocations to 1.06 MB and 12; at 16 MiB, from 36.23 MB and 42 to 16.79 MB and 12. These are microbenchmark results. |
| Client transport recovery | Actual-client fault checks and independent React verification passed. Restored after combined and client-only resource/cohort rejection. |
| Client-only recovery with no-signal request fast path | Rejected after its first screen. Postgres storage, RabbitMQ network and noise-cohort outcome/throughput/lag guards failed even against all four controls. Original client restored. [Comparison](../../.local/upload-benchmark/client-only-first-screen.json). |

`best-q1/q2/q3` combined the two worker changes with client recovery. The
[original three-versus-three evaluation](../../.local/upload-benchmark/initial-mixed-comparison.json)
rejected service resource and cohort guards. It also found no qualifying p99 or
resource gain. The combined candidate completed 2,328 uploads and rejected 552
of 2,880 offers. Its pooled READY p99 was 40.609 s, interval 38.950 to 42.387 s;
retrieval p99 was 42.558 s, interval 40.411 to 47.448 s.

Exactly one unchanged post-control was
[preselected before the last candidate results](../../.local/upload-benchmark/post-control-plan.json).
Its slower outcome shows that the first three controls understated later
run variability. It does not identify the cause. The
[transparent four-control comparison](../../.local/upload-benchmark/controlled-mixed-comparison.json)
still rejected resource and cohort guards and found no qualifying gain. Both
verdicts are preserved, with thresholds unchanged. The worker changes remain
restored; lower successful-only point estimates do not establish acceptance.

## Fresh baselines for the final retained source

The opt-in sampler fix required another freeze and fresh controls. All three
final runs started with empty queues and durable work, used fresh project volumes,
and matched protocol, fixture and environment hashes. Benchmark sampling stayed
explicitly enabled. Every row offered and recorded 960 operations, drained and
reported zero unexpected errors, timeouts, unfinished work, cleanup failures or
diagnostics. These controls do not enter earlier candidate comparisons.

| Run | Success | Reject | READY p95 / p99 s | Retrieval p99 s | Files/s | MiB/s | CPU s/success |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `final-original-q1` | 799 | 161 | 32.810 / 39.737 | 42.357 | 5.465 | 82.182 | 0.884 |
| `final-original-q2` | 837 | 123 | 32.857 / 38.434 | 44.176 | 5.211 | 79.342 | 0.877 |
| `final-original-q3` | 665 | 295 | 36.397 / 48.899 | 54.228 | 4.499 | 69.208 | 1.079 |

Together they account for 2,880 offers: 2,301 successes and 579 generator
rejections. Pooled READY p99 is 41.151 s, with a 95% interval of 37.946 to
47.304 s; verified retrieval p99 is 44.176 s, interval 39.560 to 52.593 s.
The third run's higher rejection count remains included. No cause for this
variation was established. All fixture cohorts remain below the required sample
count. Per-service costs and raw starting/final state are in
[final-fresh-baseline.json](../../.local/upload-benchmark/final-fresh-baseline.json),
with per-run stages/cohorts in the final data file. This establishes a repeated
baseline for the delivered benchmark, not an improvement over the original
application or proof that retained instrumentation has no overhead.

## Slow links and client correctness

| Evidence | Result and limit |
| --- | --- |
| `screen-cdp-slow1` | 12/12 successes, clean drainage. 512 KiB/s upload, 2 MiB/s download and 180 ms latency. READY p99 3.656 s, retrieval p99 4.356 s. |
| `screen-cdp-wan1` | 6/6 successes, clean drainage. 8 MiB/s upload, 16 MiB/s download and 180 ms latency. READY p99 11.733 s, retrieval p99 16.325 s. |
| [Actual client before/after, eight cases](../../.local/upload-benchmark/client-behavior-comparison.json) | Candidate recovered PUT 503, PUT 403, lost create response, lost completion response and multipart 503 with exact bytes. Normal and expiry cases also succeeded. Pre-abort issued zero requests. Fault timings are not performance evidence. |
| [Independent candidate React UI, four flows](../../.local/upload-benchmark/final-client-ui/ui-results.json) | Rejected candidate only: small-document retry, alpha PNG, multipart retry and cancellation passed. Document hashes, image rendering, alpha and progress were checked. Injected 503 console entries and a Google Fonts tunnel failure are recorded. Native picker and OS save dialog were not tested. |

The [final restored-client UI check](../../.local/upload-benchmark/final-combined-ui/ui-results.json)
passed normal PNG drop and a throttled 1 MiB document through Ready and verified
retrieval, with frozen image hashes/alpha and monotonic document progress. It
exercised the original client and worker images before the sampler default
toggle. It establishes no retained retry or cancellation improvement. The shared
preview could not resolve the Docker-only API host on two requests, so the
independent tester used Chromium inside the generator network.

The profiles are synthetic assumptions. Six multipart uploads at 8 MiB/s do not
establish behavior at the weakest broadband rate. Both network samples have
unbounded upper p99 confidence intervals and are functional screens only.

## Final decisions and scenario evidence

The client-only run recorded every offer and drained, with no unexpected errors.
Its READY p99 interval was 39.803 to 58.952 s. Fifteen focused client tests,
typechecking, eight real-browser fault cases and the candidate React checks
passed, but functional gains did not override the failed performance guards.
The second repeat was intentionally interrupted after that rejection; its
shutdown outcomes are archived separately and excluded. Additional repeats
cannot remove an already failed worst-run guard. No more controls were added.
Rejected client and worker proposals remain available as patches and source
archives under `.local/upload-benchmark/`.

There is no distinct accepted best to compare with the baseline. The table
below describes the retained original implementation. The network rows preceded
the candidate trials; final ramp, overload, fault and soak checks ran after
restoration. These are functional/scaling screens, each with one repeat, not
matched evidence of improvement.

| Scenario / run | Offered | Success | Reject / expected fault | READY p95 / p99 s | Retrieval p99 s | Files/s | MiB/s | CPU s/success |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `screen-cdp-slow1` | 12 | 12 | 0 / 0 | 3.656 / 3.656 | 4.356 | 0.197 | 0.062 | 1.778 |
| `screen-cdp-wan1` | 6 | 6 | 0 / 0 | 11.733 / 11.733 | 16.325 | 0.081 | 5.164 | 6.297 |
| `best-original-ramp1` | 957 | 754 | 203 / 0 | 30.078 / 39.486 | 45.469 | 4.660 | 71.994 | 0.860 |
| `best-original-overload1` | 1020 | 660 | 360 / 0 | 33.654 / 35.395 | 35.959 | 4.675 | 69.104 | 0.853 |
| `best-original-faults1` | 120 | 101 | 0 / 19 | 2.154 / 3.112 | 3.851 | 1.646 | 27.869 | 0.792 |
| `best-original-soak1` | 600 | 600 | 0 / 0 | 2.010 / 2.822 | 3.221 | 1.993 | 27.854 | 0.684 |

All six runs accounted for every offer, drained queues and durable work, and
reported zero unexpected errors, timeouts, unfinished work, cleanup failures or
diagnostics. The 19 fault outcomes verified partial transfer, XHR abort and
server ABORTED state. Both scheduled worker restarts recovered. This tests the
harness's explicit cleanup, not unattended abandoned-client expiration.

Ramp READY p99 has a 95% interval of 31.673 to 49.763 s; overload, 35.110 to
36.523 s; soak, 2.684 to 3.140 s. Fault and both network p99 intervals have no
finite upper bound. Every fixture cohort remains underpowered.

The frozen recovery guard compares pressure with the period immediately before
a load reduction. That reference may already be overloaded, so its early pass
is not proof of return to normal low-load behavior. Supplemental observations
found every queue and durable counter zero 18.669 s after the ramp's final load
ended, 3.073 s after overload, 2.478 s after faults and 3.256 s after soak.
The runner then required sustained emptiness within its 180-second deadline.
Full observations and memory windows are in
[final-confirmation-analysis.json](../../.local/upload-benchmark/final-confirmation-analysis.json).
A stable return to the ramp's initial low-load pressure was not established.

The five-minute soak completed 600/600 uploads. Image-worker median anonymous
memory rose from 942 to 1,414 MiB between the 30-to-90-second window and the
last minute; generator memory rose from 2,856 to 3,031 MiB. This is observed
growth, not evidence of leak freedom or a demonstrated leak. Queue peak was six,
and durable outbox age peaked at 94 ms. No CPU counter reset occurred in ramp,
overload or soak. Fault-run resets match the scheduled worker restarts.

## Resource costs and bottlenecks

The following ranges cover the three original mixed baselines. CPU includes
all nine containers; the service rows expose where it was spent. Network is
receive plus transmit, so cross-container traffic is counted at both endpoints.
Storage is Docker block-read plus block-write counters, not physical media I/O.
Per-success costs include rejected-work overhead and verification/cleanup.

| Service | CPU s/success | Sampled peak memory MiB | Network MiB/success | Storage MiB/success |
| --- | ---: | ---: | ---: | ---: |
| generator | 0.290 to 0.309 | 3892.613 to 4034.406 | 29.020 to 30.796 | 0.162 to 0.210 |
| api | 0.076 to 0.081 | 395.340 to 425.543 | 0.134 to 0.152 | 0.003 to 0.007 |
| document-worker | 0.001 to 0.001 | 16.469 to 25.723 | 0.005 to 0.005 | 0.011 to 0.019 |
| image-worker | 0.296 to 0.337 | 1877.305 to 2047.805 | 2.873 to 3.031 | 0.009 to 0.124 |
| minio | 0.156 to 0.186 | 1024.000 to 1024.000 | 31.963 to 33.575 | 50.826 to 55.589 |
| grafana | 0.005 to 0.006 | 511.984 to 512.000 | 0.027 to 0.049 | 0.780 to 0.861 |
| postgres | 0.013 to 0.014 | 76.586 to 88.137 | 0.028 to 0.032 | 0.094 to 0.118 |
| prometheus | 0.002 to 0.002 | 66.098 to 95.902 | 0.023 to 0.024 | 0.052 to 0.120 |
| rabbitmq | 0.024 to 0.028 | 219.059 to 232.945 | 0.010 to 0.010 | 0.044 to 0.051 |

Baseline completed-byte throughput ranged from 77.157 to 85.086 MiB/s. The
combined trial achieved 74.579 to 78.307 MiB/s, compression 79.271 MiB/s and
client-only 67.681 MiB/s. These workload-weighted byte rates must be considered
alongside completed files and rejected cohorts. Full stage distributions,
per-cohort outcomes, request counts, attempted bytes, generator lag, client heap,
throttling and per-service candidate costs are in
[final-run-data.json](../../.local/upload-benchmark/final-run-data.json) and raw run journals.

Preparing was the largest observed mixed tail stage: p99 31.796 to 42.805 s,
versus upload 15.110 to 21.366 s and create 0.394 to 0.607 s. Stage quantiles
cannot be added. Storage copying and throttling, queued image preparation and
generator CPU all constrain this local deployment. The historical MinIO CPU
profile attributed about 47% to MD5, 16% to CRC64 and 21% to syscalls. Three
checksum probes per setting did not justify a setting change.

Compression reduced the preflight stored representation from about 18 MiB to
4 MiB, including metadata. It added CPU and failed the mixed latency/resource
guards. It saves no client uplink bytes. It remains disabled.

After unsuccessful focused trials, broader investigation considered multipart
concurrency, polling, batching, document data flow and safe deduplication. The
document worker already uses server-side copy. Keeping immutable final objects
protects them from still-valid staging PUT URLs and lifecycle rules. Removing
that copy or deduplicating across owners needs new ownership, digest and lifetime
contracts. Increasing concurrency against saturated storage adds pressure.
None of these architectural changes was adopted without evidence.

Iteration stopped under the authorized shorter strategy after three rejected
end-to-end variants covering five candidate ideas. The 15-candidate ceiling was
not exhausted, and the original five-failures-after-broader-investigation rule
was not reached. No surviving candidate warranted a larger confirmation matrix.
The useful result is a repeatable screening system and rejected hypotheses;
the requested application p99/resource improvement remains unachieved.

## Verification, diagnosis and limits

The frozen setup passed 18 core tests, two browser deadline tests and the
Chromium network check. Prior API 45-test/ktlint, Go vet/race and seven system
checks may be reused only for unchanged source hashes. Original restored client typechecking and Go vet/race were repeated after
measurement, with passing logs under `final-restored-*`. The
[evaluator hash check](../../.local/upload-benchmark/final-evaluator-reuse.json)
proves that historical real 2,000 ms slowdown rejection used the same evaluator
source. This supports rejection-rule reuse, not current-workload tail power.

Historical [copy CPU flame graph](../../.local/upload-benchmark/storage-copy-default-profile/cpu-flamegraph.svg)
and three-per-side checksum probes found checksum/hash cost but no difference
outside observed variation. That isolated sequential-copy experiment bypassed
client, API and workers, so it supports no end-to-end gain claim.

Storage copy traffic, storage throttling, image CPU and generator work remain
constraints in the mixed screen. Baseline queue peaks were 113 to 120 jobs.
Safe elimination of document copying requires immutable ownership and staging
URL/lifecycle rules; increasing concurrency alone adds pressure. No such change
was accepted. Broker queue head age remains unavailable.

All cohorts remain below the evaluator's 1,000-success threshold. Short screens
cannot prove the original p99 objective, rare-event reliability or isolated
cohort resource costs. A five-minute soak can expose growth or cleanup defects;
it cannot prove long-term leak freedom or production retention/expiry behavior.
The optional one-second database backlog counts scan retained rows, and their
cost at production historical cardinality was not measured. They are disabled
by default; the benchmark explicitly includes that observation cost.
Sampled memory can miss peaks, storage counters can omit cached or delayed I/O,
and worker restarts can hide counter increments between samples. These limits
remain even when local correctness checks pass.

## Local handoff

Full-stop is applied within the explicit local-diff scope. No PR or CI run was
created. Correctness checks do not satisfy the failed performance acceptance
gate. Prior correctness and simplicity reviews cover unchanged instrumentation;
a final retained-scope review found RET-1, the default database scan. The opt-in
fix passed two context tests and ktlint, and its focused review found no new
must-fix issue. Independent original-client UI verification is recorded in
[final-review-ledger.json](../../.local/upload-benchmark/final-review-ledger.json).
[Monitoring evidence](../../.local/upload-benchmark/final-combined-ui/monitoring-evidence.json)
shows healthy Grafana/datasource and all five Prometheus targets UP. Fifteen of
sixteen dashboard query groups had finite data. The broker oldest-message-age
panel had no series, so that evidence remains missing.

[FINAL_STATUS.json](../../.local/upload-benchmark/FINAL_STATUS.json) is the final
machine-readable state. [final-task.patch](../../.local/upload-benchmark/final-task.patch)
exports only task-owned changes against `7f7aa0d`; unrelated starting staged
entries are preserved. [RESUME.md](../../.local/upload-benchmark/RESUME.md) gives
reproduction entry points without scheduling another campaign. Run directories
preserve summaries, journals, source archives and storage settings. Interrupted
and superseded runs remain excluded, including the rejected proxy run and
intentional client-only shutdown. Final UI, monitoring and shutdown artifacts
are linked from the status file. Benchmark containers and volumes were removed after final evidence, service
logs and a database dump were saved. No campaign remains active.
