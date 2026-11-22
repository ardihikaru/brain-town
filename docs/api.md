# Back-office service API

Go service in `backend/` (standard library only). It receives events from the platforms,
stores them, serves the back-office API and streams events to the town. Senders live in the
platform repos; this service only receives (see `integrations/`).

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | required | Single admin. Server-side env only. |
| `LISTEN_ADDR` | `:8081` | |
| `ARCADEDB_URL` | empty | ArcadeDB HTTP address as seen from the container. Required when `BRAIN_TOWN_MODE=prod`; empty keeps everything in memory (lost on restart). |
| `ARCADEDB_DATABASE`, `ARCADEDB_USER`, `ARCADEDB_PASSWORD` | `braintown`, none, none | Database and credentials. The service creates the database and schema when missing and the user may. |
| `PUBLIC_URL` | `http://127.0.0.1:8080` | `https://` turns on `Secure` cookies. |
| `INGEST_RATE`, `INGEST_BURST` | `50`, `200` | Per-integration token bucket for ingest. |
| `BRAIN_TOWN_MODE` | `demo` | Reported by `/api/admin/session`. |
| `BRAIN_TOWN_SECRET_KEY` | empty | Base64 of exactly 32 bytes (`openssl rand -base64 32`); encrypts GitHub webhook secrets (AES-256-GCM). Required when `BRAIN_TOWN_MODE=prod`. Otherwise, when empty, a random key is generated per process (one warning is logged) and GitHub secrets created then stop working after a restart. Server-side env only. |

## Ingest

`POST /ingest/{gaos|qa|site}/<integration-id>` with `Authorization: Bearer bt_live_…`.
Payloads and rules: [`integrations/`](integrations/). Tokens are stored as SHA-256 only and
shown once, when an integration is created or its secret is rotated.

| Status | When |
| --- | --- |
| `202` | Accepted and stored. |
| `401` | Token missing or wrong, unknown integration, or wrong source for the integration. |
| `409` | `Idempotency-Key` (else body `id`) was already accepted for this integration. |
| `422` | Body failed validation. The JSON `field` names it. |
| `429` | More than `INGEST_RATE` events/s sustained (default 50, burst `INGEST_BURST` = 200) for one integration. `Retry-After: 1`. |

`site.visit` keeps only `page`, `country` (two uppercase letters) and an optional `title`;
anything else the sender adds (an IP, a user agent) is dropped before storage.
Rejected deliveries (401 for a known integration, 422) are logged and show in the event log.

### GitHub

`POST /ingest/github/<integration-id>` takes GitHub's own signed webhook deliveries (no bearer token):
`X-Hub-Signature-256` (HMAC-SHA256 of the raw body with the integration's `whsec_` secret), `X-GitHub-Event`,
`X-GitHub-Delivery`, `Content-Type: application/json`. The route is more specific than
`/ingest/{kind}/{id}` and wins. The GitHub payload is never stored, only a small envelope.
Contract, event mapping and rollups: [`integrations/github.md`](integrations/github.md).

| Status | When |
| --- | --- |
| `202` | `{"status":"accepted"}`, `"ignored"` (event or action the town does not use) or `"skipped"` (bot sender, duplicate CI source). |
| `401` | Unknown or non-GitHub integration, or missing or wrong signature (logged as rejected for a known integration). |
| `409` | `X-GitHub-Delivery` already accepted for this integration (grouped deliveries are claimed too). |
| `413` / `415` | Body over 2 MB / content type is not `application/json`. |
| `422` | Missing `X-GitHub-Event` or `X-GitHub-Delivery`, body not JSON, or organisation mismatch (`field`). |
| `429` | Same per-integration bucket as the other sources. `Retry-After: 1`. |
| `503` | The secret cannot be decrypted (`BRAIN_TOWN_SECRET_KEY` missing or changed). |

Grouped events (comments, reviews, pushes, labels, stars, CI runs, ...) are merged for 15 s per key (at most
1,000 open rollups, flushed on shutdown) and stored as one event with id `gh-roll-<first delivery id>`.

## Streams

- `GET /events`: public. Accepted events only, masked. `Last-Event-ID` replays missed events.
- `GET /admin/events`: admin session. Every delivery, raw payload plus the public view.

Both send `id: <seq>`, `event: <type>`, `data: <json>` and a heartbeat comment every 15 s.

## Masking

One function, `visibility.View`, builds every public output. If the event's product or org is
hidden, the product and org are replaced by their aliases ("Product A", "Org A") and task
titles, URLs, step names, specs and failure reasons are removed. Masking is applied when an
event is read, so changing visibility also applies to events already stored.

## Admin API

Cookie session (`bt_session`, HttpOnly, SameSite=Strict). Bodies are JSON.

| Method and path | Purpose |
| --- | --- |
| `POST /api/admin/login`, `/logout`; `GET /session` | Sign in (10 failures/min cap), out, check. |
| `GET/POST /api/admin/integrations` | List (with today and rejected counts) or create (returns the token once). |
| `PATCH/DELETE /api/admin/integrations/{id}` | Rename, set org, set `feedUrl` (https JSON Feed 1.1 URL of a `site` integration, pulled every 5 minutes; empty disables), delete. |
| `POST /api/admin/integrations/{id}/token` | Rotate the secret; the old one stops working. For a `github` integration this makes a new `whsec_` secret (returned in the same `token` field). |
| `GET /api/admin/integrations/{id}/secret` | `github` only, `Cache-Control: no-store`: `{"secret":"whsec_…"}` so the setup page can show it again. `404` for an unknown id or another kind, `503` when it cannot be decrypted. |
| `GET /api/admin/products` | Orgs and products. |
| `PUT /api/admin/orgs/{key}`, `/products/{key}` | `visibility` (`public`/`hidden`), `alias`, product `hall`. |
| `GET /api/admin/events?integration=&type=&delivery=&q=&limit=` | Event log, newest first. |
| `GET/PUT /api/admin/settings` | `retentionDays` (1 to 3650, pruned hourly), `animation`. |
| `GET /api/admin/stats` | Counts. |

Integration objects carry `events` (the events subscribed on a GitHub webhook, from its last `ping`; `[]` until
then). `secretEnc` and `tokenHash` are never returned. A `github` integration has no token hash; its
`tokenHint` is the last 4 characters of the secret, and its `ingestPath` is `/ingest/github/<id>`.

Orgs and products are created automatically from the events that mention them. A new product
takes the visibility its sender reports; after that the back-office value wins.

## Storage (ArcadeDB)

The service keeps its working set in memory and writes every change to ArcadeDB in order, in
batches of up to 100 per transaction, about once a second and on shutdown. If the database is
unreachable, changes stay queued and are retried (the queue is capped at 50,000 and sheds the
oldest tenth beyond that). A hard crash can lose up to about a second of accepted events.
On start it loads integrations, orgs, products, the newest 5,000 events, dedupe keys and
settings, so tokens, visibility and duplicate detection survive a restart. Startup retries for
about a minute while ArcadeDB comes up.

Graph: vertices `Integration`, `Org`, `Product`, `Event`, plus `Seen` (dedupe keys) and `Meta`
(settings, sequence counter). Edges: `BELONGS_TO` (Product to Org), `PRODUCED` (Integration to
Event), `ABOUT` (Event to Product). Retention deletes old `Event` and `Seen` vertices hourly.

## Not built yet

The JSON Feed/RSS puller, pausing an integration, and changing the admin password.
