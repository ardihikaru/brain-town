# Brain Town E2E and performance tests

Playwright + TypeScript end-to-end tests and k6 performance tests for Brain Town, adopted from the Sismedika
automation-test-project-template. They run against a **local** compose stack only; Brain Town demo and production are
never targets. Rules for agents and humans: [AGENTS.md](AGENTS.md) and
[`../.claude/rules/e2e-automation.md`](../.claude/rules/e2e-automation.md).

## Quick start

```bash
cd e2e
npm ci
npx playwright install chromium
npm run env:init          # env/.env.local with random local admin + ArcadeDB passwords (git-ignored)
npm run check             # typecheck, lint, format, catalog
npm run test:local        # stack up → all projects → stack down (always, also on failure or Ctrl-C)
npm run perf:local        # stack up with raised ingest limits → k6 → stack down
```

Needs Docker with Compose, Node ≥ 22.19 (`.nvmrc` pins 22.19.0; Node 26 also works), `openssl` and `curl`.
k6 is not installed on the host: `perf/run.sh` builds and uses a pinned Docker image (k6 2.3.0 + xk6-sse 0.2.0).

## What runs

| Project                   | Folder                          | What it checks                                                    |
| ------------------------- | ------------------------------- | ----------------------------------------------------------------- |
| `api-rest`                | `tests/api/rest/{admin,ingest}` | Admin API and ingest: status codes, contracts, validation, limits |
| `api-stream`              | `tests/api/stream/events`       | `/events` and `/admin/events` SSE, masking, replay, feed puller   |
| `setup-backoffice`        | `tests/setup`                   | Signs in through the API and saves `.auth/backoffice.json`        |
| `web-town-chromium`       | `tests/web/town`                | The town shows live events in its feed; `?sim=1` simulator        |
| `web-backoffice-chromium` | `tests/web/backoffice`          | Sign-in, adding an integration, live event log                    |

Coverage per epic is in [docs/test-catalog/README.md](docs/test-catalog/README.md).

## The local stack

`scripts/stack.sh up` starts compose project **`brain-town-e2e`** from `../compose.yml` plus
[`compose.e2e.yml`](compose.e2e.yml), with `--profile db` (ArcadeDB 26.7.2), bound to `127.0.0.1:18280`:

- `web` (nginx) and `api` (Go) as in production; images are tagged `:e2e` so local/demo images are not overwritten.
- `api` gets `FEED_PULL_INTERVAL_SECONDS=2` and `SSL_CERT_FILE` pointing at a throwaway test CA, so the feed puller can
  pull an https feed without any backend change (the api image is `scratch` and has no CA bundle of its own).
- `feed-fixture` (nginx) serves JSON Feed files that the feed spec writes into `.stack/feed/`, over https with a
  certificate for `feed-fixture` signed by that CA. Both are regenerated on every `up` and deleted on `down`.
- Low ingest limits (`INGEST_RATE=5`, `INGEST_BURST=20`) so the rate-limit spec is a bounded burst.

`scripts/stack.sh down` runs `docker compose -p brain-town-e2e down -v --remove-orphans`, deletes `.stack/` and then
fails loudly if any container, volume or network of the project is left. **Always run it after a manual session.**

## Known application bugs found by this suite

| Bug                                                                                                                                                  | Where                     | Specs                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------ |
| The live back-office does not load once any product without an org exists (every GAOS product): `paintProducts()` reads `o.vis` of an undefined org. | `src/backoffice.src.html` | TC-BO-001/003/010/020/021, marked `test.fail()` ([catalog](docs/test-catalog/web-backoffice.md)) |

Other findings (not app assertions): see [perf/README.md](perf/README.md) and the `blocked` row TC-FEED-005.

## Layout

```
config/          env.ts (zod, local-only guard), targets.ts (one origin: town, back-office, admin, ingest, streams)
src/api/         core (BaseApiClient, expectJson/expectError), rest/{admin,ingest}, stream/events (SSE client)
src/data/        factories for GAOS, QA, site envelopes and JSON Feed items (real emitter shapes)
src/fixtures/    adminApi, ingestApi, integration(kind), sse, feed, cleanup; town + backoffice apps
src/web/         page objects (town, backoffice)
tests/           specs, mirrored to src/
docs/            test strategy and catalog
perf/            k6 scripts, Dockerfile, run.sh, baseline results
scripts/         init-env, test-catalog, stack.sh, with-stack.sh
```
