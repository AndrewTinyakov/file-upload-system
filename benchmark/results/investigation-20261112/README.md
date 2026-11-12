# Bash, Node and upload concurrency investigation

The reruns do not show a consistent Bash advantage. The historical slowdown occurred with byte-identical traffic code and does not reproduce as a stable launcher or benchmark-version effect. Shared VM memory reclaim is measured today and is the strongest explanation for the old result, but the archives cannot establish the exact competing workload or a single OS cause.

The client change speeds multipart uploads and adds queueing for single uploads. It does not establish an overall performance win. [PR2](https://github.com/AndrewTinyakov/file-upload-system/pull/2) remains draft with the evaluator rejection intact.

## Matched launcher and client comparison

| Version | Success / rejected | Files/s median | Files/s range | Download p99 median | CPU s/success median |
|---|---:|---:|---:|---:|---:|
| v0, Bash with current benchmark | 2758 / 122 | 6.062 | 6.052 to 6.127 | 38.49s | 0.779 |
| v1, Node with same benchmark | 2707 / 173 | 6.145 | 5.467 to 6.181 | 36.61s | 0.779 |
| v2, Node with concurrent client | 2705 / 175 | 5.964 | 5.925 to 6.166 | 36.80s | 0.785 |

Each row contains three rotated repeats and 2,880 scheduled offers. All nine runs used the same seeded 120-second quick workload at 8/s, 12-second warmup, four pages, cap 128, quotas, timeouts, verification and cleanup. All ten image references were checked before every run. The v0 and v1 generator image is identical; v2 changes only the client-containing generator. No builds ran during measurement. Fresh project volumes do not reset VM page cache or unrelated workloads.

Ranges show individual run variation, not confidence intervals. Download p99 covers verified successes, excluding admission rejections. The unchanged evaluator rejects both comparisons. The client comparison has 10 failed screening guards, 24 insufficient-cohort reasons, and no demonstrated p99-plus-resource improvement. Failed guards remain binding. Similar medians do not prove equivalence.

## Original runtime restored

| Version | Success / rejected | Files/s median | Files/s range | Download p99 median | CPU s/success median |
|---|---:|---:|---:|---:|---:|
| Original generator through Bash | 2744 / 136 | 6.161 | 5.560 to 6.241 | 36.09s | 0.770 |
| Current benchmark through Bash | 2767 / 113 | 6.080 | 5.998 to 6.279 | 37.49s | 0.782 |

These six additional runs use the same restored Bash launcher, unchanged upload client and other image IDs. Only the generator changes between the original image and the current benchmark image. All six declared runs are retained. The diagnostic deliberately changes benchmark hashes and cannot serve as a matched acceptance comparison. The original image itself varied from 871 to 940 successes today, so returning to its code does not restore its old near-zero-rejection result consistently.

All 17 new runs accounted for every offer, verified successful retrieval and drained. Current-benchmark runs also report zero unsettled client tasks and active PUTs on return. The original generator predates those settlement counters, so their absence is not treated as zero.

## What changed in the old comparison

Historical Bash repeats completed 957, 960 and 960 uploads, with median 6.506 files/s. The first failed Node run completed 292, rejected 656 at admission and timed out 12. It did not drain. Its successful-download p99 was 114.23s, with an unbounded upper 95% order-statistic interval.

The source archives and actual built browser bundle are byte-identical across those runs. Their Node/Chromium layers and both dependency locks match. All archived non-generator runtime image IDs match. Protocol hashes differ because launcher, helper and test files also enter that hash. A changed hash alone does not demonstrate changed traffic. See [built runtime hashes](built-runtime-equivalence.json) and [source/image audit](source-equivalence.json).

The failed run recorded 6,543 API major faults versus 3 to 5 in healthy historical runs, and 11,264 Grafana faults versus 650 to 1,009. API CPU per elapsed second stayed near 0.32 to 0.34 cores, while image-worker and generator CPU rates fell. The host had much higher recorded load and more running containers. The Node launcher itself used 0.15 CPU seconds and about 30MiB in a live run. Its own CPU cost does not explain the throughput collapse.

Current macOS windows show substantial compression activity and very little new disk swap-in. Occupied swap alone does not prove thrashing. Supplemental Linux VM counters directly show reclaim, file refaults and paging. These system-wide counters include unrelated workloads and began partway through the first runtime repeat. PSI is unavailable. This evidence supports memory/I/O stalls as a cause to investigate, without proving the historical OS mechanism. See the [independent attribution audit](attribution-audit.json) and the raw VM observer.

## Client tradeoff

Median across three per-run upload-stage means, unchanged client versus candidate:

| Fixture | Unchanged | Candidate |
|---|---:|---:|
| 256MiB multipart noise | 11.72s | 7.27s |
| 64MiB multipart noise | 3.01s | 1.73s |
| 64MiB plus one byte, text multipart | 3.54s | 2.30s |
| 64MiB minus one byte, single PUT | 1.41s | 1.57s |
| 16KiB text, single PUT | 141ms | 320ms |

The upload stage includes presigning, limiter waiting and PUTs. These are admitted-success populations under saturation, not identical completed work or pure network timings.

A separate existing WAN scenario used 180ms latency, 64Mbit/s upload and 128Mbit/s download per page. Both sides verified all six offers with no admission rejections. The two 64MiB multipart-noise uploads averaged 9.81s versus 8.54s in their upload stage. Four single-PUT uploads averaged 8.27s versus 8.30s. This pair supports the intended multipart behavior below saturation; six samples per side do not certify tails or nonregression.

The four-slot limiter is per page/module. Four benchmark pages permit up to sixteen candidate PUTs together. The UI ordinarily starts one file at a time; the mixed benchmark deliberately overlaps many files per page. Existing client tests and source reviews find no demonstrated slot leak or oversubscription defect. Production API cancellation remains partial; the benchmark additionally routes deadlines to API fetches.

## Benchmark fixes and recommendation

Keep the Node launcher and retain [restored Bash](../../legacy-bash/) as a controlled diagnostic. The exact original archive is preserved separately from the runnable adaptation. The following fixes were prepared separately and applied after all 17 measurements finished:

- Reserve Bash result names before external commands and preserve orphaned diagnostic sidecars.
- Preserve scheduled client trace selection while also retaining API/worker asset-ID trace correlation.
- Name the PUT peak per page and correct the stale cancellation limitation.
- Run browser seam regressions in CI using the existing packaged esbuild dependency.

These instrumentation bytes were not used for the frozen measurements. Future acceptance comparisons require a fresh matched baseline. The original canonical baseline and candidate bundles remain unchanged.

Keep PR2 draft and retain its client as a measured candidate. Separate multipart parallelism from the shared single-upload limit in the next causal experiment. Use an isolated VM, disclose the generator's cost, and compare identical admitted fixture cohorts below saturation. Retain the saturated workload as a separate capacity test. Keep the cap, resource guards and insufficient-tail verdicts intact.

The benchmark cap also includes verified retrieval and cleanup. Canonical cleanup occupies about 1 to 1.4 average slots, much less than client work, so removing it does not explain the main bottleneck. The generator preloads 493,158,870 fixture bytes per page, about 1.84GiB across four pages before runtime/verification buffers, even for focused scenarios. Loading only selected fixtures is a useful next benchmark improvement, with a new baseline. It is not evidence for a production upload refactor.

## Recheck the evidence

[analysis.json](analysis.json) contains every run, cohort stage means and resource counters. [campaigns.json](campaigns.json) records execution order, commands, exact image IDs and sanitized host counts. [comparisons.json](comparisons.json) retains evaluator methods, every guard and rejection reason.

[raw-runs.tar.gz](raw-runs.tar.gz) contains exact journals, summaries, environments, protocols and fixture manifests for 17 new runs and 4 historical observations. The [manifest](raw-manifest.json) records each member's SHA256 and the archive digest. Large source archives, screenshots, service logs and full host/container inventories stay in ignored local storage. No unrelated workload names are published.

Extract the compact bundle into a fresh directory and rerun the unchanged evaluator, for example:

```sh
mkdir -p /tmp/upload-investigation-evidence
tar -xzf benchmark/results/investigation-20261112/raw-runs.tar.gz -C /tmp/upload-investigation-evidence
node benchmark/src/evaluate.mjs \
  --baseline /tmp/upload-investigation-evidence/matched/v1/r1,/tmp/upload-investigation-evidence/matched/v1/r2,/tmp/upload-investigation-evidence/matched/v1/r3 \
  --candidate /tmp/upload-investigation-evidence/matched/v2/r1,/tmp/upload-investigation-evidence/matched/v2/r2,/tmp/upload-investigation-evidence/matched/v2/r3 \
  --output /tmp/upload-investigation-comparison.json
```

Exit 1 is the preserved rejection. To rerun load, pin all image references from campaigns.json, use a fresh label and exclusive access to the benchmark Compose project, then invoke the recorded Bash or Node command with build reuse. Old local images and host conditions may be unavailable elsewhere.


## Verification

The final benchmark delta passes 45 benchmark tests, 11 client tests, client
typechecking, Bash syntax and ShellCheck. The two new regressions failed before
the fixes and passed afterward. Round 5 independent correctness and simplicity
reviews found no further issues; a focused round 6 checked the final CI dependency
installation mode.

A separate tester ran the actual restored Bash command against real services,
verified 10 downloads and live empty RabbitMQ/database backlog, then confirmed a
repeated label preserved all 25 original evidence files. It independently checked
all 205 raw archive member hashes and 18,252 operation records. Project cleanup
preserved all 58 unrelated running containers. See [verification.json](verification.json)
for the executed command, source hashes, observations and limits.
