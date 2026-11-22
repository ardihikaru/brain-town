# Architecture

> The full architecture and system design document for v1 was written in Claude Docs:
> https://claude.ai/artifact/7jfJgb8DTH4d6BT6CvZ1HF (owner access; use its Export menu for
> Markdown, Word or PDF). This page summarises the design as it stands in this repository and
> should replace that link once the full document is exported here.

## Concepts

| In your platforms | In the town |
| --- | --- |
| A product (GAOS) or repo | A hall in its district |
| A task or issue | A person who queues, waits, is worked on and leaves |
| An agent picking up work | A walker carrying that piece of work |
| A published article or illustration | A courier walking to the press or the pendopo |
| A test run | A QA bot stepping through the QA Lab |
| A video pipeline | Work moving through the Video Generator and YouTube Company |
| A site visit | A traveller arriving from the visitor's country |

The town **only reacts to events**. Nothing in it is polled, and nothing is invented except
animation detail (who a visitor looks like, the route they take, how long they stay).

## Components

```
            ┌──────────────── platforms ────────────────┐
            │ GAOS · QA Tool · mfardiansyah.id · yours  │
            └──────┬──────────────┬─────────────┬───────┘
     POST /ingest/gaos/<id>  /ingest/qa/<id>  /ingest/site/<id>   (Bearer bt_live_…)
     POST /ingest/github/<id>                                     (X-Hub-Signature-256)
                   ▼
        ┌──────────────────────┐        ┌────────────────────────┐
        │  Brain Town backend  │◀──────▶│  ArcadeDB (graph)      │
        │  (planned)           │  HTTP  │  database `braintown`  │
        └───┬──────────────┬───┘        └────────────────────────┘
   GET /events (SSE)   /admin/events, integrations API
            ▼                 ▼
     town page          back-office
  (web/town)          (web/backoffice)
```

- **Town page.** A single HTML file: canvas renderer, road-graph pathfinding (BFS on the tile
  grid), agents, a clock, and an **event bus** (`bus.emit(event)`). On load it opens
  `/events` (SSE) and converts the public envelopes into bus events (`fromPublic`); a built-in
  simulator runs only as a static demo when the stream is unreachable or with `?sim=1`.
- **Back-office.** A single HTML file for integrations (ingest URL + token per platform, with
  the setup guide embedded), products and visibility, an event log, health and settings. v1
  uses sample data.
- **Backend (planned).** Receives ingest POSTs, validates the token per integration,
  de-duplicates by event `id`, stores the event, and fans it out on `/events`.
- **GitHub receiver** (`backend/internal/github`). Verifies GitHub's HMAC signature with the
  integration's secret (stored AES-GCM encrypted with `BRAIN_TOWN_SECRET_KEY`), keeps only a small
  envelope (never the GitHub payload), and groups noisy events (comments, reviews, pushes, CI,
  refs, labels, stars) into one rollup per subject every 15 s. Contract:
  [`integrations/github.md`](integrations/github.md).
- **Feed puller** (`backend/internal/feed`). Every `FEED_PULL_INTERVAL_SECONDS` (default 300) it pulls the JSON Feed 1.1 of each `site` integration that has a `feedUrl` and records new items as `article.published`, deduped against pushes by item id.
- **ArcadeDB.** A graph database (HTTP API on port 2480). Products, tasks, runs, integrations
  and events become vertices and edges, which fits "who did what to which product".

## Event model

Every event has the same envelope:

```json
{ "id": "stable-unique-id", "type": "domain.verb", "at": "2026-11-22T00:14:03Z", "data": { } }
```

The types the town understands today are listed in the `EVENT BUS` comment at the top of the
town's script. They include `article.*`, `illustration.published`, `magazine.printed`,
`video.*`, `issue.*`, `task.*`, `pr.*`, `qa.run.*`, `qa.step`, `imago.*` and `site.visit`, plus
the GitHub types `ci.run`, `repo.*`, `ref.*` and `discussion.*`. The
per-platform contracts are in [`integrations/`](integrations/).

## Design rules

1. **Push only.** Platforms send; Brain Town never calls them back.
2. **Idempotent by `id`.** Re-sent events are counted once.
3. **Never block the sender.** Short timeouts; a failed send is logged and ignored.
4. **Public content only.** Drafts, private repos and hidden products stay out unless made
   visible in the back-office.
5. **No personal data.** Visits carry a page and a two-letter country code, nothing else.

## Brand

The mark (the Lit hall) has three treatments, one per surface: Day for the live town, Demo for
the simulated town and Night for the back-office. The town page shows Demo until the `/events`
stream opens, then switches its tab icon and header mark to Day. Sources, rasters and usage rules
are in [`web/brand/`](../web/brand/README.md); nginx serves them from `/brand/`, plus
`/favicon.ico` and `/apple-touch-icon.png` at the root.
