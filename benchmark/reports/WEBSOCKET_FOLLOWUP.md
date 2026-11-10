# Websocket optimization follow-up

We found and tested a useful transfer from the websocket project, but it did not
pass the upload campaign's acceptance rules. Notification-driven outbox dispatch
removed about one second from small-document latency and roughly halved status
polls in stable runs. Mixed high-load throughput and tails worsened. The original
publisher is restored. The tested proposal and all measurements remain archived.
The broad p99 and resource objective remains unachieved.

## What the websocket project changed

The project is `/Users/andrewtinyakov/code/pet/websockets`.

- [Commit 6c77879](https://github.com/AndrewTinyakov/websockets/commit/6c77879c3738192ed6300c157ad297591b980701) added transaction-deferred PostgreSQL notifications, a dedicated listener, durable SQL draining and a one-second polling fallback.
- [Commit 31f590c](https://github.com/AndrewTinyakov/websockets/commit/31f590c24e17c3f06b6f398230cb0d452d66c6f0) shared transactions for up to 16 sends assembled within 5 ms, acknowledged only after commit, and retained bounded publication claims.
- [Merged PR 4](https://github.com/AndrewTinyakov/websockets/pull/4), merged as `d3d6443`, also reduced redundant read-state writes and notification-claim SQL work. Later scalability work used shared encoded events, compact queue references, bounded workers and batched Redis reads.

The old websocket latency comparison also changed consumers per replica, so its
numbers cannot isolate a batching benefit. No numerical wakeup-only speedup was
established there. These are standard patterns, but they need measurements in
the upload system before adoption.

Upload publication already locks up to 20 SQL rows, sends the batch, waits once
for RabbitMQ confirms and marks publication in one transaction. Adding that
batching again would duplicate existing behavior. The new experiment therefore
transferred notification wakeups while preserving the publication transaction.

## Frozen experiment

The preselected [plan](../../.local/upload-benchmark/wakeup-experiment-plan.json)
uses the final protocol freeze
`23e1b53ed015ea0c76890874a59bbaed8d508acf303b0a1843410e54ecc6ee36`.
Fixture and environment hashes match the final original controls. Workload,
resource limits, replicas, generator placement, warmup, deadlines and evaluator
were unchanged. These results do not enter the earlier freeze's comparisons.

Three small-document controls preceded three alternating small/mixed candidate
pairs. Small runs select the existing `text-small.bin` fixture with `COHORT`;
all use 120 seconds at 8 arrivals per second and 12 seconds of warmup. Each run
starts from fresh volumes and records every one of 960 independently scheduled arrivals.
The mixed controls are `final-original-q1/q2/q3`. One original small post-control
was preselected before candidate results to diagnose drift. It is excluded from
acceptance limits. No favorable repeat replaced an unfavorable run.

The implementation used a statement-level AFTER INSERT notification, LISTEN
before SQL scanning, notification clearing before claims, one owned listener
thread, reconnect handling, bounded shutdown and session cleanup. One connection
remained borrowed from the SQL pool. Missing notifications still trigger the
existing one-second durable scan. Rabbit confirms, row locking, asset handling,
image encoding, client transfer and document copying stayed unchanged.

## Results

Every row offered and recorded 960 operations. All completed runs drained queues
and durable work with zero unexpected errors, timeouts, unfinished operations,
cleanup failures or diagnostics. Rejections are generator admission failures,
not server HTTP rejections. Latencies below are conditional on success and start
at scheduled arrival, including generator lag.

| Run | Success | Reject | READY p95 / p99 s | Retrieval p99 s | CPU s/success | Polls/success |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `wakeup-small-b1` | 960 | 0 | 1.388 / 1.455 | 1.457 | 0.0993 | 4.026 |
| `wakeup-small-b2` | 960 | 0 | 1.390 / 1.458 | 1.465 | 0.0978 | 4.045 |
| `wakeup-small-b3` | 573 | 387 | 55.653 / 58.788 | 58.806 | 0.4249 | 8.675 |
| `wakeup-small-c1` | 960 | 0 | 0.362 / 0.423 | 0.426 | 0.0969 | 2.001 |
| `wakeup-small-c2` | 960 | 0 | 0.356 / 0.406 | 0.409 | 0.0985 | 1.997 |
| `wakeup-small-c3` | 960 | 0 | 0.350 / 0.406 | 0.408 | 0.0894 | 1.999 |
| `wakeup-small-post-control1` | 960 | 0 | 1.394 / 1.454 | 1.460 | 0.0997 | 4.037 |
| `final-original-q1` | 799 | 161 | 32.810 / 39.737 | 42.357 | 0.8841 | 44.473 |
| `final-original-q2` | 837 | 123 | 32.857 / 38.434 | 44.176 | 0.8769 | 42.245 |
| `final-original-q3` | 665 | 295 | 36.397 / 48.899 | 54.228 | 1.0792 | 53.015 |
| `wakeup-mixed-c1` | 622 | 338 | 39.633 / 65.744 | 68.188 | 1.1543 | 59.441 |
| `wakeup-mixed-c2` | 562 | 398 | 45.831 / 70.887 | 73.933 | 1.3880 | 49.151 |
| `wakeup-mixed-c3` | 704 | 256 | 38.264 / 48.507 | 49.543 | 1.0674 | 50.159 |

The small candidate completed 2,880/2,880 uploads. Against the two stable original
small controls, p99 fell from 1.455 to 1.458 seconds to 0.406 to 0.423 seconds,
about 71% to 72% lower. Polls fell from 4.03 to 4.04 per success to about 2.00.
This is scoped latency and request-count evidence. Total CPU per success ranged
from 0.0894 to 0.0985 seconds, compared with 0.0978 to 0.0993 in the two stable
controls. Costs do not improve consistently beyond control variability; no CPU saving
beyond observed variation is established.

The third unchanged small control completed only 573 uploads and rejected 387,
with p99 58.788 seconds and CPU 0.425 seconds per success. Its API CPU and queues
rose despite no code change. Cause was not established. It remains in all
three-versus-three acceptance calculations. The apparent gap from this bad
control is not attributed entirely to notification wakeups.

The preselected unchanged post-control completed 960/960 uploads, with READY p99 1.454 seconds and CPU 0.0997 seconds per success. It drained without unexpected errors. This shows the earlier slow small control did not recur in this one run; it does not establish its cause or restore stable host conditions throughout the campaign. The post-control remains diagnostic and does not enter acceptance thresholds.

Mixed candidates completed 1,888 uploads and rejected 992 of 2,880 offers,
compared with 2,301 successes and 579 rejections for their matching controls.
Candidate READY p99 ranged from 48.507 to 70.887 seconds, versus 38.434 to
48.899 seconds. CPU per success ranged from 1.067 to 1.388 seconds, versus
0.877 to 1.079. The measurements do not support keeping this candidate for the
requested high-load objective. Baseline instability limits causal attribution;
the candidate's worse completed work cannot be excused by its small-file gain.

The unchanged evaluator rejects [small](../../.local/upload-benchmark/wakeup-small-comparison.json)
and [mixed](../../.local/upload-benchmark/wakeup-mixed-comparison.json) comparisons.
Small failed 6 of 85 guards, mixed 76 of 184. Mixed failures include meaningful
throughput, p95, p99, CPU and individual-cohort outcomes, as well as smaller
ancillary counter differences. Small failed storage/network/monitoring guards;
its unstable control also prevents satisfying the specified improvement rule.
Nothing was silently waived.

Quantiles use exact unrounded observations, 1 ms histogram bins and marginal
95% binomial order-statistic intervals. The small candidate's per-run p99
intervals are 0.401 to 0.474, 0.381 to 0.423 and 0.374 to 0.429 seconds.
The stable controls' intervals are 1.441 to 1.495 and 1.439 to 1.503 seconds.
Queue correlation can widen uncertainty beyond those marginal intervals. Pooled
small groups exceed 1,000 successes per side; each mixed fixture cohort remains
underpowered. Mixed container counters do not establish individual-cohort
resource safety. These runs are synthetic local Docker evidence, not a
production-capacity claim.

Stage distributions, completed files and bytes per second, client heap, generator lag,
request and attempted-byte counts, and per-service CPU, memory, network and storage
costs are preserved in [wakeup-run-data.json](../../.local/upload-benchmark/wakeup-run-data.json).
The underlying run directories preserve sampled traces, raw pressure and resource
journals, image references and equivalent starting-state observations. The mixed
candidate completed 3.33 to 4.57 files/s and 51.61 to 72.41 MiB/s, versus 4.50 to
5.46 files/s and 69.21 to 82.18 MiB/s for its controls. Container network totals
count traffic at both endpoints; block counters do not measure physical media I/O.

## What rejected means and how to improve evaluation

A rejected candidate failed acceptance and was restored. That does not imply a
correctness defect or prove that every failed counter difference was caused by
its code. A rejected operation is an offered arrival that the generator could
not start at its fixed 128-inflight limit. Both are preserved in the results.

The [guard audit](../../.local/upload-benchmark/guard-audit-summary.json) found that
an earlier byte-identical original post-control failed 61 of 184 guards.
The original three controls did not capture later variability. Some candidate
failures were tiny ancillary differences; others involved substantial lost
throughput or worse tails. A blanket relaxation would conceal the latter.

For a future agreed freeze, prefer fixed interleaved baseline/candidate blocks,
unchanged controls, run-level uncertainty and prospectively agreed practical
regression margins. Treat unstable controls as inconclusive. Keep integrity,
access isolation, accounting, durability, recovery and unexpected-error
protections. Preserve protected latency, throughput and resource measures within
each relevant cohort. Diagnostic counter breaches need confirmation rather than
an automatic speedup claim or a silent waiver. This is a recommendation only;
no evaluation rule or historical verdict was changed.

## Next architectural investigation and stopping decision

An independent review considered a four-PUT-per-page FIFO client limit. It is a
plausible way to reduce storage and browser contention, but a bare wrapper would
be unsafe. The original uploader does not settle its promise on XHR abort, so
an aborted PUT could retain a semaphore permit forever. Queue acquisition also
needs cancellation to prevent transfers starting after operation deadlines.
FIFO cannot eliminate waiting behind large or stalled transfers. Four has not
been shown to be the right bound. No limiter was implemented or measured, and
no performance result is claimed for it. The
[assessment](../../.local/upload-benchmark/bounded-put-assessment.md) records the
necessary correctness checks.

Retaining immutable final objects still protects ready documents from staging
PUT URLs and lifecycle cleanup. Eliminating that copy needs an explicit immutable
upload and object-lifetime design. Increasing multipart or worker concurrency
without controlling the saturated storage path is not an established solution.
These larger changes remain candidates for a separately designed experiment.

This follow-up adds one measured architectural candidate, bringing the ledger to
six ideas. It stops after the preselected comparisons and diagnostic control:
the candidate fails high-load guards and unstable controls make further
sequential trials poor causal evidence. The 15-candidate ceiling and original
five-consecutive-failure limit were not exhausted. We are stopping at diminishing
returns under the authorized shorter strategy, not declaring the optimization
objective complete. No further baseline repeats were added to widen tolerances.

## Correctness, review and handoff

The candidate passed the full 55-test API suite and ktlint. After adding one
real-pool lifecycle test, all three focused PostgreSQL notification integration
tests and ktlint passed. These cover commit/rollback notification semantics,
missed-signal fallback, listener termination/reconnect, pool isolation and LISTEN
cleanup. The lifecycle test mocks the publication callback; existing real
SQL/Rabbit API tests cover publication confirms, routing failures, concurrent
publishers and batches. Two independent source reviews found no must-fix issue;
the optional real-pool coverage gap was then addressed. This is not a claim of
an independently verified candidate UI/fault campaign.

The original publisher and all eight candidate paths were restored byte for
byte after archiving the final candidate, including its latest test. No new
candidate migration or dependency change remains in the application diff.
Existing final original-client UI, network/fault/scaling checks and both retained
instrumentation review perspectives remain the evidence for unchanged delivered
behavior. The existing report records their limits. This follow-up does not
claim a new slow-link, overload, recovery or soak improvement.

The final local diff retains the benchmark, bounded sampled observations and
allocation diagnostic. No commit, push, PR, merge or CI run was made. The starting
index is preserved. Final candidate sources are in
`.local/upload-benchmark/wakeup-proposal-final/`; source tarballs, starting state,
operations, histograms, traces and resource journals accompany every run.
Final shutdown, preservation and exported-patch evidence are linked from
`.local/upload-benchmark/FINAL_STATUS.json`.
