# Brain Town

**A living, hand-drawn town where real work becomes people.** Brain Town turns events from the
platforms you run (issues, pull requests, test runs, published articles, videos, site visits) into
small citizens who walk the streets: a courier carries a new article to the press, a QA bot walks
through each step of a test run, an agent picks up a task in its product hall and leaves when it
is done.

It is a single HTML page drawn on a `<canvas>` (no framework, no build step), plus a static
back-office for managing integrations.

- **Live demo (simulated events):** https://town.demo.mfardiansyah.id
- **Back-office demo:** https://town.demo.mfardiansyah.id/backoffice/
- **Production (the author's real platforms):** https://town.mfardiansyah.id

> Status: **v1, static.** The town runs a built-in simulator today. The ingest/events backend
> (ArcadeDB-backed) that will feed real events is on the [roadmap](#roadmap). The integration
> contracts it will accept are already written: see [`docs/integrations/`](docs/integrations/).

<!-- Screenshot: add docs/img/town.png and docs/img/backoffice.png -->

---

## Contents

- [Features](#features)
- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [Real-world integration](#real-world-integration)
- [Configuration](#configuration)
- [Repository layout](#repository-layout)
- [Deployment](#deployment)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)

## Features

**The town** (`web/town/index.html`)
- An ink-on-paper isometric town with districts: Town Park, Castle, Press Quarter,
  LinkedIn Street, Social Row, Video Generator, YouTube Company, GitHub Valley, Kampung,
  Perumahan and the Countryside. Buildings are in Javanese, European, Arabic, Chinese and
  Japanese styles.
- A day/night cycle with times of day, a clock, and speed controls (pause, 1×, 2×, 4×).
- Pan and zoom, plus "go there" jumps to each district.
- A live feed panel and counters: magazine issues, articles, illustrations, videos shipped,
  issues in queue and issues closed.
- Every visible change is driven by an **event**. Halls per product, couriers, QA bots, farm
  harvests, visitors arriving from other countries and the occasional sky crash are all
  reactions to the event stream.
- Runs fully offline apart from web fonts. The simulator emits realistic events until you
  connect a real source.

**The back-office** (`web/backoffice/index.html`)
- Dashboard with event rate ("events per 10 seconds"), integration health and a live tail.
- Integrations: add one, get its ingest URL and token, and read the setup guide for each
  platform (the task files in `docs/integrations/` are embedded).
- Products and their visibility in the town, an event log, and settings (service, database,
  account).
- v1 ships with sample data; it does not talk to a server yet.

## Quick start

No build is needed. Pick one:

```bash
# 1. Just open it
xdg-open web/town/index.html          # macOS: open web/town/index.html

# 2. Any static server
python3 -m http.server -d web 8080    # town: /town/  back-office: /backoffice/

# 3. Container (same layout as production: town at /, back-office at /backoffice/)
docker compose up --build             # http://127.0.0.1:8080
```

### Feeding it real events

The town listens to one event bus. To switch from the simulator to a Server-Sent Events
stream, run this in the browser console, or in a script tag after the page loads:

```js
brainTown.connect('https://town.mfardiansyah.id/events')
```

Each SSE message is one JSON event such as:

```json
{ "id": "post-shipping-reports", "type": "article.published", "at": "2026-11-21T09:14:03Z",
  "data": { "title": "Shipping reports as images", "url": "https://mfardiansyah.id/blog/shipping-reports", "to": "blog" } }
```

The full list of event types is documented at the top of the town's script (the `EVENT BUS`
comment) and in [`docs/integrations/`](docs/integrations/). Org, repo, channel and creator
names live in the `CONFIG` block near the top of the same script: rename them to yours.

## How it works

```
 your platforms ──POST /ingest/<platform>/<id>──▶  Brain Town backend  ──SSE /events──▶  town page
 (GAOS, QA tool,      Bearer token per             (planned; stores events,          (canvas; animates
  your website, …)    integration                   integrations in ArcadeDB)          each event)
                                                            ▲
                                       back-office ─────────┘  manage integrations, products, tokens
```

- **Push, never pull back.** Platforms only send events. Brain Town never calls them.
- **Idempotent.** Every event carries a stable `id`, so an item seen twice (for example by a
  feed and a webhook) is counted once.
- **Best effort.** A failed send must never fail the sender's deploy or test run (short
  timeouts, no retries for visits).
- **Privacy first.** Visit beacons carry only the page and a two-letter country code: no IPs,
  user agents, cookies or identifiers.

More in [`docs/architecture.md`](docs/architecture.md).

## Real-world integration

Brain Town is built to show **the author's own working life**, so the production town at
https://town.mfardiansyah.id is wired to three real platforms. Each has a full integration
contract in `docs/integrations/` that you can copy for your own platforms.

| Platform | What it is | What appears in the town | Integration doc |
| --- | --- | --- | --- |
| **[mfardiansyah.id](https://mfardiansyah.id)** | The author's personal site and blog. | A pendopo (open pavilion). Couriers carry new articles and illustrations to it, and visitors travel in from their countries. Links to [`/office`](https://mfardiansyah.id/office). | [mfardiansyah-id.md](docs/integrations/mfardiansyah-id.md) |
| **[GAOS](https://github.com/ardihikaru/gaos)** | A graph-native agent operating system: product and task management for AI coding agents, with a design gate, a kanban, and integrations for an AI gateway and QA tools. Open source. | Every GAOS product is a hall, and every task is a person who queues, waits at the design gate, gets worked on by an agent and leaves when done. | [gaos.md](docs/integrations/gaos.md) |
| **QA Tool** | The author's Playwright end-to-end testing tool. *Not open source yet; it will be released later.* | Each test run is a QA bot walking through its steps in the QA Lab, passing or failing each one. | [qa-tool.md](docs/integrations/qa-tool.md) |

Nothing in Brain Town is specific to these platforms: any system that can send an HTTP POST
with the documented JSON can join the town.

## Configuration

The static pages take no server configuration. Container and server settings come from an
env file (copy [`.env.example`](.env.example)):

| Variable | Default | Purpose |
| --- | --- | --- |
| `BRAIN_TOWN_MODE` | `demo` | `demo` (simulated events) or `prod`. |
| `PUBLIC_URL` | `http://127.0.0.1:8080` | Public base URL of this instance. |
| `BIND_ADDR` | `127.0.0.1` | Host address the container is published on. |
| `PORT` | `8080` | Host port. |
| `ARCADEDB_URL` | `http://127.0.0.1:2480` | ArcadeDB HTTP API. *For the planned backend.* |
| `ARCADEDB_DATABASE` | `braintown` | Database name. |
| `ARCADEDB_USER` / `ARCADEDB_PASSWORD` | | Database credentials. Keep them in the env file only. |

In the page itself, `CONFIG` (orgs, repos, channels, creators, `dayLength`) controls names and
pacing.

## Repository layout

```
web/
  town/index.html          the town (single file)
  backoffice/index.html    the back-office (single file, task docs embedded)
src/
  backoffice.src.html      back-office source before the task files are embedded
deploy/
  Dockerfile               nginx 1.30.7 image: town at /, back-office at /backoffice/
  nginx/site.conf          container vhost (+ /healthz)
  edge/brain-town.conf     reference copy of the public TLS edge vhost
compose.yml                one service; one compose project per environment
docs/                      documentation (start at docs/README.md)
artifacts/v1/              the original v1 package, kept as the frozen source of record
```

## Deployment

The pages are static, so they can be hosted anywhere. The author's deployment:

- **Edge:** nginx 1.30.7 terminates TLS (Let's Encrypt) and proxies over WireGuard.
- **App:** two containers from this repo: `demo` (`town.demo.mfardiansyah.id`) and `prod`
  (`town.mfardiansyah.id`).
- **Database:** a shared ArcadeDB server (database `braintown`), wired into prod via env vars.

Step-by-step, including redeploys: [`docs/deployment.md`](docs/deployment.md).

## Roadmap

- [ ] Ingest + events backend: `POST /ingest/{gaos,qa,site}/<integration-id>` with Bearer
      tokens, an `/events` SSE stream, and storage in ArcadeDB (graph of products, tasks, runs
      and events).
- [ ] Back-office backed by the real API (integrations, tokens, products, event log).
- [ ] Feed puller for sites that only expose JSON Feed / RSS.
- [ ] Prod town connects to `/events` by default; the demo keeps the simulator.
- [ ] Screenshots and a short screen recording in the docs.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). For security
reports, see [SECURITY.md](SECURITY.md).

## License

[Apache License 2.0](LICENSE) © Muhammad Febrian Ardiansyah
