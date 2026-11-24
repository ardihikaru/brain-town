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

`POST /ingest/{gaos|qa|site|animora}/<integration-id>` with `Authorization: Bearer bt_live_…`.
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

QA events (`/ingest/qa/<id>`): if `org` is omitted, Brain Town fills it from the integration's org (stored and public
payload both carry it); an `org` the sender gives is kept, even when it differs from the integration's. Each QA tool
instance is its own integration with an admin-chosen name, see [`integrations/qa-tool.md`](integrations/qa-tool.md).
Rejected deliveries (401 for a known integration, 422) are logged and show in the event log.

Animora events (`/ingest/animora/<id>`): `video.started`, `video.rendered`, `video.render_failed`, `video.scheduled`,
`video.published`, `video.publish_failed` and `channel.connected`. Only the documented `data` fields are kept (anything else is dropped); `vendor` must be
`youtube`, `facebook`, `instagram` or `tiktok` and `url` https, else `422` with `field` `data.<name>`. Every `video.*` type may carry an optional `data.code` (opaque video code, `[A-Za-z0-9_-]`, max 32; anything else is silently dropped, not `422`). `video.started` and `video.render_failed` also require `data.run` (opaque run id, `[A-Za-z0-9_-]`, max 64) and `data.stage` (`naskah` or `render`), else `422`; `video.rendered` may carry an optional `data.run` (invalid is dropped, not `422`). The stored event is
rebuilt as `{"id","type","at","product":"@animora-video","org","data"}` (`org` from the integration, when set). Contract:
[`integrations/animora.md`](integrations/animora.md).

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
| `503` | The secret cannot be decrypted (`BRAIN_TOWN_SECRET_KEY` missing or changed), or busy (4 bodies already in flight, `Retry-After: 1`). |

Grouped events (comments, reviews, pushes, labels, stars, CI runs, ...) are merged for 15 s per key (at most
1,000 open rollups, flushed on shutdown) and stored as one event with id `gh-roll-<first delivery id>`.

## Streams

- `GET /events`: public. Accepted events only, masked. `Last-Event-ID` replays missed events. `?replay=N` (1 to 500) starts a new subscriber with the newest N events, oldest first (ignored when `Last-Event-ID` is sent); `?kind=github|gaos|qa|site|animora` keeps one source, for the replay and the live frames.
- `GET /admin/events`: admin session. Every delivery, raw payload plus the public view.

Public `qa` events (every `/events` frame, including `Last-Event-ID` replay, and the public view in `/admin/events`)
carry a top-level `tool`, the name of the QA integration that sent them (next to `seq`, `id`, `type`, `source`, `at`,
`payload`). The name is admin-chosen and public, so it is not masked. It is omitted when the integration was deleted
or has no name, and never present on other sources.

Both send `id: <seq>`, `event: <type>`, `data: <json>` and a heartbeat comment every 15 s.

### `GET /api/town` (public, no auth)

Masked snapshot the town page loads once to draw GitHub owners (gates) and their repos (halls). Sent with
`Cache-Control: no-store`; other methods get `405`. The body also carries `timezone`, the configured IANA zone
(setting `timezone`, default `Asia/Jakarta`) that the town uses for its clock and every time it shows.

```json
{
  "owners": [
    { "name": "ardihikaru", "type": "user", "hidden": false, "lastEventAt": "2026-11-23T08:00:00Z",
      "repos": [ { "name": "brain-town", "hidden": false, "lastEventAt": "2026-11-23T08:00:00Z" },
                 { "name": "Product A", "hidden": true } ] }
  ],
  "unowned": [ { "name": "Product C", "hidden": true, "lastEventAt": "2026-11-23T07:00:00Z" } ]
}
```

- `owners`: one per org that has a product or is the org of a `github` integration, sorted by `name`. `name` is
  the org's public name: its alias when the org is hidden, or public with a custom alias (see Masking), else the
  org key. `type` is the integration's `ownerType` (`user`,
  `organization`, or `""`); it is always `""` for hidden owners, since the type of an alias would reveal a personal account.
- `repos` (and `unowned`, the products with no org): `name` is the public product name exactly as `/events`
  publishes it (alias when the product or its org is hidden). Repos sharing a public name inside one owner are
  merged, so a hidden org shows only distinct aliases. Sorted by `name`; arrays are never `null`.
- `lastEventAt` (RFC 3339 UTC) is the newest accepted event for the repo or the repo's last delivery on the
  GitHub integration; omitted when there is none. An owner's value is the newest of its repos.

## Masking

One function, `visibility.View`, builds every public event output, and `visibility.Town` builds `/api/town`; both
resolve names through `visibility.Aliases`, so hidden names are masked in one place. If the event's product or org is
hidden, the product and org are replaced by their aliases ("Product A", "Org A") and task
titles, URLs, step names, specs and failure reasons are removed (for `animora`: `title`, `url`, `channel` and `account`;
`vendor`, `dueAt`, `publishedAt`, `language`, `duration`, `format` and `code` stay). Masking is applied when an
event is read, so changing visibility also applies to events already stored. `/api/town` is computed on each
request and never contains a hidden org key, hidden product key or product name.

**Public org with a custom alias.** An org alias that differs from the key (and is not a generated `Org A`) is the
org's public name also when the org is public, in `/events` (`payload.org`) and in `/api/town` (`owners[].name`).
To keep the key from leaking in the same event, `View` also replaces the org key, as a whole token and case-insensitively,
inside `payload.data` (recursively) and `payload.task.title`; a token is delimited by any character outside
`[A-Za-z0-9_-]`, so `developersismedika` and `sismedika-web` do not match key `sismedika`. Any `data` field named `url`
that contains the key as a token is deleted (a rewritten URL would be a broken link). A public org whose alias equals
its key is output unchanged. The same substitution runs when the product is hidden but the org is public with a custom alias.

What a public org with a custom alias still reveals: product and repo names that contain the key
(`payload.product`, `payload.repo`, `repos[].name`), the QA tool name (`tool`, an admin-chosen integration name), and
free text where the key is glued to other letters, digits, `-` or `_`. Renaming an alias gives the org a new public name,
so the town sees a new owner at its next `/api/town` refresh: the old gate is removed and a new one placed.

## Admin API

Cookie session (`bt_session`, HttpOnly, SameSite=Strict). Bodies are JSON.

| Method and path | Purpose |
| --- | --- |
| `POST /api/admin/login`, `/logout`; `GET /session` | Sign in (10 failures/min cap), out, check. |
| `GET/POST /api/admin/integrations` | List (with today and rejected counts) or create (returns the token once). `kind` is `gaos`, `qa`, `site`, `animora` or `github`. A `github` create may carry `ownerType` (`user` or `organization`; anything else is `422`; ignored for other kinds). A `qa` create whose trimmed name equals another QA integration's name (case-insensitive) is `409` `{"error": "..."}`. |
| `PATCH/DELETE /api/admin/integrations/{id}` | Rename, set org, set `ownerType` (`github` only, same validation), set `feedUrl` (https JSON Feed 1.1 URL of a `site` or `animora` integration, pulled every 5 minutes; empty disables), delete. Any kind can be renamed: `name` is trimmed, empty or over 80 characters is `422`, and a name another integration of the same kind already uses (trimmed, case-insensitive, excluding itself) is `409`; the same name on a different kind is fine. An unknown id is `404` first. A GitHub rename changes only the display name, never `org` or `ownerType`. Create keeps the `409` for `qa` only. |
| `POST /api/admin/integrations/{id}/token` | Rotate the secret; the old one stops working. For a `github` integration this makes a new `whsec_` secret (returned in the same `token` field). |
| `GET /api/admin/integrations/{id}/secret` | `github` only, `Cache-Control: no-store`: `{"secret":"whsec_…"}` so the setup page can show it again. `404` for an unknown id or another kind, `503` when it cannot be decrypted. |
| `GET /api/admin/products` | Orgs and products. |
| `PUT /api/admin/orgs/{key}` | Body `{"visibility"?: "public"\|"hidden", "alias"?: string}`; `200` with the org. `alias` is trimmed. `""`, or the key (any case) on a public org, resets it: key when public, a generated `Org A` when hidden. Otherwise 1-60 characters from letters, digits, space and `. , ' & ( ) _ + - : # !`, else `422`; a hidden org's alias equal to its key is `422`. Names matching the generated pattern (`Org A`, `Org 123456`) are reserved and `422`. An alias equal (case-insensitive) to another org's alias or key is `409`. Visibility is applied first: hidden to public keeps a custom alias and resets a generated one to the key; public to hidden keeps a custom alias and turns alias=key into `Org A`. An unknown key is `404`, unless an integration names it as its org, in which case the org is created public (alias = key) and the change applied. Checks run under the store lock. |
| `PUT /api/admin/products/{key}` | `visibility` (`public`/`hidden`), `alias`, `hall`. An empty (after trim) `alias` on a **hidden** product resets it to a generated default (`Product A`); on a public product it is ignored. |
| `GET /api/admin/events?integration=&type=&delivery=&q=&limit=` | Event log, newest first. |
| `GET/PUT /api/admin/settings` | `retentionDays` (1 to 3650, pruned hourly), `animation`, `timezone` (IANA name, default `Asia/Jakarta`; omitted or empty keeps the current value; an unknown zone or `Local` is `422` `{"error":"timezone must be an IANA time zone name ..."}`). |
| `GET /api/admin/stats` | Counts. |

Integration objects carry `events` (the events subscribed on a GitHub webhook, from its last `ping`; `[]` until
then). `secretEnc` and `tokenHash` are never returned. A `github` integration has no token hash; its
`tokenHint` is the last 4 characters of the secret, and its `ingestPath` is `/ingest/github/<id>`.

Integration objects also carry `ownerType` (`"user"`, `"organization"` or `""` while unknown; always present). It is set
once from the first payload (an `organization` object, else `repository.owner.type`) and never overwritten by a
delivery. The list (`GET /api/admin/integrations`) adds `repos`, always an array (`[]` for non-github or no repos),
sorted by `name`:

```json
{"name":"gaos","private":true,"hookEvents":["issues","pull_request"],"lastEventAt":"…","lastRejectedAt":"…",
 "today":3,"rejected":0,"product":"gaos","visibility":"hidden","alias":"Product B","aliasCustom":false,"defaultAlias":"Product B"}
```

`today` and `rejected` count this integration's accepted and rejected deliveries received today for that repo.
`product`, `visibility` and `alias` come from the products store (`product` is `""` and `alias` is `""` until the
product exists; `visibility` then follows `private`). `aliasCustom` is false when the alias equals the key or matches
the generated `Product A` / `Product 093015` pattern. `defaultAlias` is the current alias when it is not custom; for a
custom alias it is what an empty-alias reset would give (the key when the product is public).

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
