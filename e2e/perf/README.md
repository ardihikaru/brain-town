# Performance tests (k6)

Separate from the E2E specs, as the template requires. Local stack only.

```bash
npm run perf:local     # stack up (INGEST_RATE/INGEST_BURST raised to 100000) → perf/run.sh → stack down
```

`run.sh` builds `brain-town-e2e-k6:2.3.0-sse0.2.0` once from [`Dockerfile`](Dockerfile) (grafana/xk6 1.4.15 building
k6 v2.3.0 with `github.com/phymbert/xk6-sse` v0.2.0, all pinned), runs each script with
`docker run --rm --network host`, samples `docker stats` of the api container every second into
`results/api-stats.csv`, and fails if the api was OOM-killed or restarted. Results are git-ignored.

| Script          | Load                                                                                        | Thresholds (baseline)                                                                               |
| --------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `ingest.js`     | ramping arrival rate to 200 events/s (10 s), hold 30 s, ramp down 5 s; one GAOS integration | ingest p95 < 200 ms, failures < 1 %, every response 202                                             |
| `sse-fanout.js` | 50 `/events` subscribers; ingest 50 events/s for 30 s after a 5 s warm-up                   | delivery lag p95 < 1 s, 0 stream errors, every subscriber gets events, ingest p95 < 200 ms, all 202 |

Knobs: `INGEST_TARGET_RPS`, `SSE_SUBSCRIBERS`, `SSE_INGEST_RATE` (pass with `-e` in `run.sh` if needed).

## Baseline (first run, 2026-11-23, local workstation, ArcadeDB profile on)

| Metric                                   | Result                                         |
| ---------------------------------------- | ---------------------------------------------- |
| ingest: requests                         | 7,550 ingest (avg 168/s over the 45 s ramp)    |
| ingest: latency p95 / p90 / max          | 1.14 ms / 0.97 ms / 5.45 ms                    |
| ingest: failures / non-202               | 0 % / 0                                        |
| SSE: subscribers                         | 50, all received events, 0 errors              |
| SSE: events delivered to subscribers     | 67,550 (≈ 1,930/s across 50 streams)           |
| SSE: delivery lag p95 / avg / max        | 4 ms / 2.15 ms / 11 ms                         |
| SSE run: ingest latency p95              | 3.55 ms                                        |
| api container peak memory (both scripts) | 37.1 MiB of 64 MiB; not OOM-killed, 0 restarts |

A second run the same day agreed: ingest p95 1.34 ms, SSE delivery lag p95 4 ms (max 15 ms), peak memory 37.6 MiB.
All thresholds passed both times. They are deliberately loose; tighten them once a few more runs agree.

## Findings beyond the baseline

An earlier unthrottled variant (20 VUs posting back-to-back, ~960 requests/s) broke the stack:

- After roughly 30 s, **35 % of requests failed with 502**. The web container's nginx logged
  `connect() to <api>:8081 failed (99: Address not available)`: `deploy/nginx/site.conf` proxies to the api without an
  upstream `keepalive`, so every request opens a new TCP connection and the ephemeral ports run out (TIME_WAIT).
  Admin calls (login) failed too until the sockets drained. Sustained traffic of a few hundred requests/s through the
  container nginx will hit this; an `upstream { keepalive …; }` block with `proxy_http_version 1.1` would avoid it.
- The api container reached **63.8 MiB of its 64 MiB limit** within ~10 s at that rate (no OOM kill in that run).
  Memory to watch: the dedupe map (`Seen`) keeps one key per accepted event for the whole retention window.

These are recorded as findings, not as failing thresholds, because the designed load is ~50 events/s per integration.
