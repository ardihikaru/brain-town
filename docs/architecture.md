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
| A video pipeline (Animora) | Work moving through the Video Generator, then to the YouTube, Facebook, Instagram or TikTok company |
| A site visit | A traveller arriving from the visitor's country |

The town **only reacts to events**. Nothing in it is polled, and nothing is invented except
animation detail (who a visitor looks like, the route they take, how long they stay).

## Components

```
            ┌──────────────────── platforms ─────────────────────┐
            │ GAOS · QA Tool · mfardiansyah.id · Animora · yours │
            └──────┬──────────────┬─────────────┬──────────┬─────┘
     POST /ingest/gaos/<id>  /ingest/qa/<id>  /ingest/site/<id>  /ingest/animora/<id>   (Bearer bt_live_…)
     POST /ingest/github/<id>                                     (X-Hub-Signature-256)
                   ▼
        ┌──────────────────────┐        ┌────────────────────────┐
        │  Brain Town backend  │◀──────▶│  ArcadeDB (graph)      │
        │  (planned)           │  HTTP  │  database `braintown`  │
        └───┬──────────────┬───┘        └────────────────────────┘
   GET /api/town (snapshot)   /admin/events, integrations API
   GET /events   (SSE)
            ▼                 ▼
     town page          back-office
  (web/town)          (web/backoffice)
```

- **Town page.** A single HTML file: canvas renderer, road-graph pathfinding (BFS on the tile
  grid), agents, a clock, and an **event bus** (`bus.emit(event)`). On load it fetches the
  public snapshot `GET /api/town` (owners and their repos, masked like `/events`) and opens
  `/events` (SSE), converting the public envelopes into bus events (`fromPublic`); a built-in
  simulator runs only as a static demo when the stream is unreachable or with `?sim=1`
  (in that mode `/api/town` is never requested).
- **GitHub Valley layout.** The district has three owner gates (a gate holds up to three halls, one per
  repo, plus a `+n repos` board), a Pagoda Yard for products with no owner (GAOS), the Backlog Pagoda, the Tea
  House and a gate register that lists every owner. The sample layout (three sample compounds) is drawn by the
  simulator and while no real owner is known. As soon as the stream is open and an owner is known (from the
  snapshot, waiting at most 2 s for it, or from an event) the town switches to one gate per real owner, ranked by
  recent activity once; after that placed gates and halls never move. Events with an unknown owner or repo add it
  and trigger a debounced refetch of `/api/town`. Details: [`integrations/github.md`](integrations/github.md#owners-and-repos-in-the-town).
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
- **Animora receiver** (`/ingest/animora/<id>`). One integration per Animora deployment, shared by its two senders.
  It keeps only an allowlist of `data` fields per type and rebuilds the stored event with `product: "animora"`.
  Contract: [`integrations/animora.md`](integrations/animora.md).
- **Feed puller** (`backend/internal/feed`). Every `FEED_PULL_INTERVAL_SECONDS` (default 300) it pulls the JSON Feed 1.1 of each `site` or `animora` integration that has a `feedUrl` and records new items, deduped against pushes by item id: `article.published` for `site`, `video.published` for `animora` (items without a valid `_animora.vendor` are skipped).
- **ArcadeDB.** A graph database (HTTP API on port 2480). Products, tasks, runs, integrations
  and events become vertices and edges, which fits "who did what to which product". A GitHub integration is one per
  owner: besides `events` it keeps `ownerType` (`user`/`organization`) and `repos` (per-repo hook events, privacy,
  last event and last rejection, stored as a JSON string property like `events`; records without them still load).

## Event model

Every event has the same envelope:

```json
{ "id": "stable-unique-id", "type": "domain.verb", "at": "2026-11-22T00:14:03Z", "data": { } }
```

The types the town understands today are listed in the `EVENT BUS` comment at the top of the
town's script. They include `article.*`, `illustration.published`, `magazine.printed`,
`video.*`, `issue.*`, `task.*`, `pr.*`, `qa.run.*`, `qa.step`, `imago.*` and `site.visit`, plus
the GitHub types `ci.run`, `repo.*`, `ref.*` and `discussion.*` and the Animora type `channel.connected`. The
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
