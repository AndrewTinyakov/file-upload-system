# Hybrid repeat 2

Independent analysis found a valid adverse run, with an early backend slowdown followed by preparation queues and admission rejection. Its initiating cause remains unresolved. The run is retained.

| Measurement | Hybrid r1 | v2 r2 | Hybrid r2 |
|---|---:|---:|---:|
| Successful / rejected | 901 / 59 | 900 / 60 | 705 / 255 |
| First rejection after start | 93.874 s | 94.499 s | 18.749 s |
| First 10 s mean creating | 0.05 s | 0.05 s | 1.02 s |
| First 10 s mean uploading | 0.31 s | 0.38 s | 2.00 s |
| First 10 s mean preparing | 2.68 s | 2.26 s | 10.54 s |
| Whole-run mean preparing | 10.82 s | 10.85 s | 19.46 s |
| Successful logical GiB | 13.543 | 13.570 | 10.520 |
| MinIO CPU seconds | 129.71 | 135.18 | 141.75 |
| MinIO throttled seconds | 507.60 | 520.43 | 698.82 |
| PostgreSQL throttled seconds | 0.17 | 0.32 | 27.25 |
| Generator major faults | 41058 | 41302 | 48472 |
| MinIO major faults | 17560 | 19286 | 21489 |
| Generator peak sampled GiB | 3.94 | 3.98 | 4.31 |

Resource deltas cover approximately 164 seconds for the two controls and 157 seconds for hybrid r2. Throttling counters aggregate across execution contexts and are not wall-clock outage durations. PostgreSQL's counter jumps 26.515 seconds between samples at 11.56 and 20.05 seconds. API polling requests also stall during that interval. Session creation is already slow around 2 to 5 seconds, so this event alone cannot explain onset.

All admitted uploads succeed. Every rejection says `Generator inflight capacity reached`. No retries, cleanup failures, active PUTs at return or unfinished server uploads occur. Around 60 seconds, hybrid r2 has 46 document and 70 image jobs versus 22/41 and 25/41 in the controls. Cleanup adds about 0.1 to 0.4 seconds to typical scheduled-time bucket means, far less than preparation time.

There is no demonstrated memory-thrash origin. First 20 seconds generator peak sampled memory is 3.443 GiB versus 3.410 and 3.469 GiB. First approximately 15 seconds host pageins are 156 MiB versus 194 and 19 MiB. Hybrid r2 has 44 swapin pages and zero swapout pages over its samples. Later pageins are higher after the slowdown begins.

Additional concurrent SINGLE and multipart transfers remain a plausible bandwidth or scheduling contribution. First 20 seconds maximum sampled per-page PUT concurrency is 8 versus 5 and 4. The same hybrid implementation performs much better in r1, so these observations neither prove candidate causality nor justify discarding r2 as host noise. No concrete upload-code defect was demonstrated.

Reproduce from the exact journals in `raw-runs.tar.gz`: subtract each summary's `measurementStartMs`, group successful operations by scheduled 10-second bins, calculate stage means, and count rejections separately. Subtract first and last service resource counters. Host page deltas use the observed 16384-byte page size. Full host inventories stay in ignored local storage.
