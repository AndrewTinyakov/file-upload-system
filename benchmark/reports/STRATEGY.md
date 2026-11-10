# Short benchmark strategy

The user approved a shorter campaign instead of the estimated 15 to 18 hour full
matrix. Use short runs to reject weak candidates, then spend confirmation time
only on changes that survive. The original scenarios remain in `protocol.json`.
Shorter runs provide fewer observations and cannot establish the same tail
latency evidence as the full matrix.

## Frozen comparison

Use the instrumentation frozen after the short-workflow review fixes. The actual
hash and reviewed inputs are in
`.local/upload-benchmark/freeze-short-current.json`. Take fresh baselines against
that freeze. Do not combine historical runs with different protocol, fixture or
environment hashes. Further instrumentation changes require a new freeze and
fresh baselines.

Keep seeded fixtures, fresh project volumes, resource limits, replicas,
concurrency, deadlines, correctness checks and acceptance guards unchanged.
`run.sh` recreates the isolated benchmark volumes for each run. Compare matched
baseline and candidate repeats under the same host conditions, without concurrent
builds or unrelated workloads. Warmup, drainage, builds and startup add wall time
beyond the measured durations below.

## Run selection

| Scenario | Measured load | Purpose |
| --- | --- | --- |
| `quick` | 120 seconds at 8 operations/s, three repeats per side | Initial mixed-workload screen |
| `slow` | 60 seconds at 0.2 operations/s | Small files over a constrained connection |
| `wan-multipart` | 60 seconds at 0.1 operations/s | Multipart threshold and transfer behavior |
| `quick-ramp` | 150 seconds, 2 to 16 operations/s and recovery | Queue growth and load reduction |
| `quick-overload` | 140 seconds, including 32 and 16 operations/s bursts | Overload and recovery |
| `quick-faults` | 60 seconds at 2 operations/s | Slow, interrupted, cancelled and retried work, worker restarts |
| `quick-soak` | 300 seconds at 2 operations/s | Short resource-growth and cleanup screen |

`slow` uses 512 KiB/s upload, 2 MiB/s download and 180 ms latency.
`wan-multipart` uses 8 MiB/s upload, 16 MiB/s download and 180 ms latency.
Each browser page uses Chromium CDP network emulation, enabled after local
fixture preparation. Independent single/concurrent PUT and GET checks establish
that requests on one page share its configured aggregate rates. Browser profile
settings, Docker counters and attempted upload bytes accompany run evidence.
The fault scenario reserves its fault page and uses the same CDP mechanism.
These latency and bandwidth values are synthetic assumptions, not measured
production connections or traffic distributions. Multipart coverage does not
establish behavior on the weakest broadband connection.

## Candidate triage

1. Record one hypothesis, the focused change and its correctness checks. Start
   with the cheapest relevant screen. Use three matched `quick` repeats for a
   performance comparison and reject clear correctness or resource regressions.
2. Inspect accounting, error outcomes, throughput, generator lag, recovery and
   per-cohort latency before attributing an apparent speedup to the application.
   Dropped work, unfinished transfers or a saturated generator are failures.
3. Give survivors only the confirmation scenarios relevant to the hypothesis.
   A transport change needs both network profiles and faults. A queue or worker
   change needs ramp, overload, faults and the short soak. Preserve three matched
   repeats per side for evaluator comparisons.
4. Add isolated cohort runs only when a surviving claim needs cohort tail or
   resource evidence. Stop when further runs would not change the decision.

Example commands, run sequentially on the corresponding source revision:

```sh
./benchmark/run.sh quick short-baseline-quick-1
./benchmark/run.sh quick short-candidate-quick-1
./benchmark/run.sh slow short-candidate-slow-1
./benchmark/run.sh wan-multipart short-candidate-wan-1
./benchmark/run.sh quick-faults short-candidate-faults-1
node benchmark/evaluate.mjs \
  --baseline .local/upload-benchmark/short-baseline-quick-1,.local/upload-benchmark/short-baseline-quick-2,.local/upload-benchmark/short-baseline-quick-3 \
  --candidate .local/upload-benchmark/short-candidate-quick-1,.local/upload-benchmark/short-candidate-quick-2,.local/upload-benchmark/short-candidate-quick-3 \
  --output .local/upload-benchmark/short-quick-comparison.json
```

Create the second and third repeats before evaluating. Network and fault
comparisons also need matching baseline evidence. Never reuse a label or switch
source revisions while a run is active.

## Evidence and stopping

Retain all offered, dispatched and terminal counts, generator rejects, failures,
timeouts and unfinished operations. Preserve interruption journals and partial
artifacts, and exclude incomplete runs from acceptance. A low successful-only
latency does not excuse missing work. Record candidate decisions in `REPORT.md`
with run labels and the reasons for retaining or restoring each change.

The evaluator still requires exact quantiles, 95% order-statistic confidence
intervals, three matched repeats and at least 1,000 successes per evaluated group.
An undersized cohort remains insufficient evidence. Mixed runs cannot establish
cohort resource nonregression. Short network and fault screens can expose broken
behavior; they do not prove rare-event rates, production p99 or long-term leak
freedom. Functional reliability fixes can stand on correctness and measured
screening evidence while the original comprehensive p99 objective stays unproven.

One additional run is worthwhile when it answers a specific unresolved question,
such as reproducibility of a failure, a recovery boundary or a surviving cohort's
wide interval. Preselect that question and the evidence needed. Do not repeat
until a favorable result appears. Prefer a few focused candidates and stop at
diminishing returns. The limit is 15 measured candidates, not a target; the
protocol's earlier failure stop also applies. Report missing evidence plainly.
