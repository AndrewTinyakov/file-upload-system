# Upload benchmark

Runs the actual upload client in Chromium through verified download, measuring
latency, throughput, errors and resources.

Requires Docker Compose, Java 25 and Node.js 24.11+. From the repository root:

```sh
npm run bench -- run
npm run bench -- run --scenario quick
npm run bench -- list
npm run bench -- stop
```

`run` defaults to a smoke check. `quick` measures two minutes; startup, warmup
and drainage take extra time. Run names are automatic.

JSON/JSONL results go to `.local/upload-benchmark/`, including per-upload timings
and resource samples for graphs. See the [saved results](results/).

Runs reset the benchmark's Docker volumes. Run one at a time without other load.
`stop` removes its containers and volumes, keeping saved results.

## Compare

Compare three matching runs per side using their names or paths:

```sh
npm run bench -- compare \
  --baseline baseline-1,baseline-2,baseline-3 \
  --candidate candidate-1,candidate-2,candidate-3 \
  --output comparison.json
```

Comparisons need matching configuration hashes and 1,000 successes per group.

See `npm run bench -- --help`, [scenarios](config/protocol.json) and
[resource limits](docker/compose.yaml).


## Measurement details

The [restored Bash launcher](legacy-bash/) is available for controlled launcher
comparisons. Both launchers start the same Node and Chromium load generator.

`clientPutConcurrencyPeakPerPage` is the largest PUT peak observed on any one
page. With the candidate's four-slot budget in each page's module, four benchmark
pages can use up to sixteen PUTs together. Older summaries call this per-page value
`clientPutConcurrencyPeak`.

Client traces include operations selected by `traceEvery` and operations selected
by the API and worker asset-ID sampling rule. `serverTraceSampled` identifies the
latter so client-only traces are distinguishable from joined traces. These
instrumentation changes require a fresh matched baseline for future comparisons.

Admission rejections count against the offered workload. Successful latency and
resource costs cover a population that can differ between runs under saturation.
Keep outcome counts and fixture mix beside those comparisons.
