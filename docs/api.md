# Back-office service API

Go service in `backend/` (standard library only). It receives events from the platforms,
stores them, serves the back-office API and streams events to the town. Senders live in the
platform repos; this service only receives (see `integrations/`).

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | required | Single admin. Server-side env only. |
| `LISTEN_ADDR` | `:8081` | |
| `DATA_FILE` | empty | JSON snapshot path. Empty keeps everything in memory. |
| `PUBLIC_URL` | `http://127.0.0.1:8080` | `https://` turns on `Secure` cookies. |
| `BRAIN_TOWN_MODE` | `demo` | Reported by `/api/admin/session`. |

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
| `429` | More than 20 events/s sustained (burst 60) for one integration. `Retry-After: 1`. |

`site.visit` keeps only `page`, `country` (two uppercase letters) and an optional `title`;
anything else the sender adds (an IP, a user agent) is dropped before storage.
Rejected deliveries (401 for a known integration, 422) are logged and show in the event log.

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
| `PATCH/DELETE /api/admin/integrations/{id}` | Rename, set org, delete. |
| `POST /api/admin/integrations/{id}/token` | Rotate the secret; the old one stops working. |
| `GET /api/admin/products` | Orgs and products. |
| `PUT /api/admin/orgs/{key}`, `/products/{key}` | `visibility` (`public`/`hidden`), `alias`, product `hall`. |
| `GET /api/admin/events?integration=&type=&delivery=&q=&limit=` | Event log, newest first. |
| `GET/PUT /api/admin/settings` | `retentionDays` (1 to 3650, pruned hourly), `animation`. |
| `GET /api/admin/stats` | Counts. |

Orgs and products are created automatically from the events that mention them. A new product
takes the visibility its sender reports; after that the back-office value wins.

## Not built yet

ArcadeDB storage (the snapshot is the interim store), GitHub signed webhooks (no contract
yet), the JSON Feed/RSS puller, pausing an integration, and changing the admin password.
