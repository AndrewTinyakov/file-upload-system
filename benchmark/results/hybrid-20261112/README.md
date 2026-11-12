# Hybrid upload experiment

The hybrid removes SINGLE uploads from the multipart queue and retains concurrent multipart parts. It does not solve the overall performance regression in this campaign. Large-file upload stages remain faster than v1, while small uploads remain slower and the hybrid completes fewer offered uploads. Prefer v1 scheduling for deployment and keep PR2 draft. The hybrid is preserved as an experiment, not an accepted optimization.

## Matched results

All rows contain three rotated repeats, each with 960 offers. Files/s, p99 and CPU costs are medians across repeats. Files/s includes time until the last measured operation finishes; p99 covers verified successes. Admission rejections are excluded from successful latency, so these populations differ.

| Version | Success / rejected | Median files/s | Files/s range | Median download p99 | CPU s/success |
|---|---:|---:|---:|---:|---:|
| v1 | 2787 / 93 | 6.117 | 6.009 to 6.309 | 37.03s | 0.772 |
| v2 | 2696 / 184 | 5.997 | 5.966 to 6.036 | 36.21s | 0.779 |
| hybrid | 2476 / 404 | 5.766 | 4.796 to 6.018 | 36.49s | 0.817 |

Individual runs, all retained:

| Version | Repeat | Success / rejected | Files/s | Download p99 |
|---|---:|---:|---:|---:|
| v1 | 1 | 924 / 36 | 6.117 | 37.03s |
| v2 | 1 | 888 / 72 | 5.966 | 36.21s |
| hybrid | 1 | 901 / 59 | 6.018 | 36.49s |
| v2 | 2 | 900 / 60 | 5.997 | 37.55s |
| hybrid | 2 | 705 / 255 | 4.796 | 39.48s |
| v1 | 2 | 941 / 19 | 6.309 | 33.67s |
| hybrid | 3 | 870 / 90 | 5.766 | 35.31s |
| v1 | 3 | 922 / 38 | 6.009 | 39.80s |
| v2 | 3 | 908 / 52 | 6.036 | 35.82s |

## Upload stage by file

Median of three per-run successful-upload means. Includes signing, application queue wait and PUTs. These are stage means, not end-to-end p99 or pure network timings.

| File | v1 | v2 | Hybrid |
|---|---:|---:|---:|
| 16KiB text, SINGLE | 0.129s | 0.246s | 0.215s |
| 64MiB minus one byte text, SINGLE | 1.348s | 1.508s | 1.769s |
| 64MiB noise, multipart | 3.009s | 1.456s | 1.446s |
| 64MiB plus one byte text, multipart | 3.251s | 2.106s | 2.318s |
| 256MiB noise, multipart | 11.558s | 7.081s | 7.078s |

SINGLE now calls the same direct PUT path as v1. The server still selects the strategy, with the existing 64MiB boundary. Multipart keeps its shared four-slot page budget. Total PUT concurrency can exceed four when SINGLE transfers overlap multipart work. The tests prove that a SINGLE upload finishes while all four multipart slots remain occupied.

Removing that application queue does not reserve network, browser or storage capacity for small uploads. They still share those resources with parallel large-file parts. This provides a mechanism for continued contention, not proof of the exact cause of every observed latency difference. Admission also changes which fixture instances succeed.

## Conditions and acceptance

All versions use the current Node launcher and common benchmark image 719a0710, with only `client/src/upload.ts` overlaid before rebuilding its bundles. [Image/source hashes](image-audit.json) verify the caller, protocol and dependency locks match. v1 uses 4faabb21 upload.ts, v2 uses 3d9e511, and the hybrid is the one-line direct-SINGLE change. Service image IDs remain fixed. All protocol, fixture and environment hashes match across nine runs.

Each run uses the unchanged quick scenario: 120 seconds at 8 offers/s, 12 seconds warmup, four browser pages, cap 128, normal quotas/timeouts/download verification/cleanup, fresh project volumes and compression off. All builds finish before measurement. Unrelated workloads are preserved. Fresh volumes do not reset VM caches or eliminate shared-host contention. The generator still preloads all fixtures; its cost is unchanged across arms.

The order is v1r1,v2r1,hybridr1,v2r2,hybridr2,v1r2,hybridr3,v1r3,v2r3. [Campaign](campaign.json) retains exact commands, immutable image IDs and sanitized host conditions. No run is replaced or dropped. The previous canonical and investigation bundles remain unchanged.

The unchanged evaluator gives:

- v1-hybrid: `reject`, 99 failed guards. All reasons and guards remain in [comparisons.json](comparisons.json).
- v2-hybrid: `reject`, 104 failed guards. All reasons and guards remain in [comparisons.json](comparisons.json).
- v1-v2: `reject`, 30 failed guards. All reasons and guards remain in [comparisons.json](comparisons.json).

The hybrid fails global admission-rejection, successful-throughput, generator-lag and resource guards against both controls. These are measured screening failures, separate from insufficient tail samples.

Rare cohorts remain below the required 1000 successes, so comprehensive tail and resource nonregression remain unproven. Failed guards are not waived because some cohorts are underpowered. Similar p99 medians alone do not show equivalence.

Hybrid r2 has 705 successes and 255 rejections, with the first rejection at 18.749 seconds rather than approximately 94 seconds in the comparison runs. Its slowdown begins across session creation, upload and preparation. PostgreSQL throttling rises sharply and MinIO consumes more CPU despite fewer successful bytes. No initial memory-thrash cause is demonstrated. Extra transfer contention remains plausible, and shared-host causality is also unproven. See the [independent anomaly analysis](anomaly.md). This adverse run stays in every result.

## Correctness and review

All 8640 offers across the nine comparison runs have exactly one terminal record. All admitted operations succeed, with no timeouts, cleanup failures or unfinished server uploads. Every run drains, with zero unsettled client tasks and active PUTs at return.

The separate real-service hybrid smoke verifies ten downloads, including six SINGLE and four multipart uploads, and completed database sessions. Queues and durable backlog drain. Its peak concurrency is four, so that smoke alone does not demonstrate saturated bypass. [Independent verification](verification.json) records the commands and limitations. The regression test establishes the saturated application scheduling behavior.

All 12 client tests, 45 benchmark tests and client typecheck pass. Two independent review perspectives find no correctness or simplicity defects in the hybrid delta. The existing [review ledger](ledger.json) carries forward prior rounds and records the focused extension for this new behavior. The production change remains one line. No migration is required and rollback is a client-code revert.

## Recheck

[analysis.json](analysis.json) contains every fixture, stage means, stage/download percentiles, outcomes and service counters. [comparison.html](comparison.html) is the interactive file selector. [raw-runs.tar.gz](raw-runs.tar.gz) preserves exact journals, summaries, protocol/environment/fixture manifests and host counter samples for all nine runs plus the smoke. [raw-manifest.json](raw-manifest.json) hashes each member and the archive. Full service logs, source archives and unrelated workload inventories remain ignored local artifacts.

```sh
mkdir -p /tmp/upload-hybrid-evidence
tar -xzf benchmark/results/hybrid-20261112/raw-runs.tar.gz -C /tmp/upload-hybrid-evidence
node benchmark/src/evaluate.mjs \
  --baseline /tmp/upload-hybrid-evidence/v1/r1,/tmp/upload-hybrid-evidence/v1/r2,/tmp/upload-hybrid-evidence/v1/r3 \
  --candidate /tmp/upload-hybrid-evidence/hybrid/r1,/tmp/upload-hybrid-evidence/hybrid/r2,/tmp/upload-hybrid-evidence/hybrid/r3
```

Rerun source arms by building the common generator, copying the indicated revision's `upload.ts` to `/src/client/src/upload.ts` in a child image, and running `node src/build.mjs` in that image. Pin all service images from the campaign manifest, tag each generator in the declared order, and use the recorded `--reuse-build` commands with fresh project volumes. Host conditions will differ. A repeat is new evidence, not an exact replay.

The next useful performance experiment is an isolated host with equal admission and a specified small-file latency budget. Keep the saturated mixed scenario as a capacity guard. This experiment does not justify shipping either candidate as a general performance improvement.
