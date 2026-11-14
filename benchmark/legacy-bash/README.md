# Historical Bash launcher

`run-original.sh` preserves `benchmark/run.sh` from commit `3956e3bb280e500c81f853aa8e352b732e9e069e` byte for byte. It is an archival copy and expects its original path.

`run.sh` runs from this directory against the current measured harness. It adjusts the repository path, reserves an unused result name, bounds health requests, records local image IDs, and prevents implicit builds or pulls during startup. `BENCHMARK_REUSE_BUILD=1` skips the original build phase for matched experiments. Without it, the original explicit build steps run.

```sh
BENCHMARK_REUSE_BUILD=1 bash benchmark/legacy-bash/run.sh quick bash-control-unique-name
```

Run only with exclusive access to the `upload-benchmark` Compose project. Both launchers reset its volumes. Pin and verify every local image ID before each run; changing only the launcher isolates launcher behavior. The archive alone does not recreate historical host conditions. Results go to `.local/upload-benchmark/<label>/`.
