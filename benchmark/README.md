# Upload benchmark

Runs the actual upload client in Chromium through verified download, measuring
latency, throughput, errors and resources.

Requires Docker Compose, Java 25 and Node.js. From the repository root:

```sh
npm run bench -- run
npm run bench -- run --scenario quick
npm run bench -- list
npm run bench -- stop
```

`run` defaults to a smoke check. `quick` measures two minutes of mixed traffic;
startup, warmup and drainage take extra time. Names are automatic, and each run
prints its results directory under `.local/upload-benchmark/`.

Runs reset the benchmark's Docker volumes. Run one at a time without other load.
`stop` removes its containers and volumes, keeping saved results.

## Compare

Use `run --scenario quick --name baseline-1` to name a run. Collect three runs
per side, then compare their names or paths:

```sh
npm run bench -- compare \
  --baseline baseline-1,baseline-2,baseline-3 \
  --candidate candidate-1,candidate-2,candidate-3 \
  --output .local/upload-benchmark/comparison.json
```

Comparisons require matching configuration hashes and 1,000 successes per group.
Changed benchmark inputs require fresh baselines; short runs may return
`insufficient_evidence`.

See `npm run bench -- --help`, [scenarios](config/protocol.json),
[resource limits](docker/compose.yaml) and [run results](reports/BASELINE.md).

## Checks

```sh
npm ci --prefix benchmark
node --test benchmark/tests/*.test.mjs
```
