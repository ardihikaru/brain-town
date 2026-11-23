# Animora → Brain Town

> **Platform:** Animora — the author's video studio: it turns a script (naskah) into a rendered video and publishes it to each kanal's YouTube, Facebook, Instagram and TikTok accounts.
> **In the town:** rendered videos come out of the Video Generator, and published videos arrive at the YouTube, Facebook, Instagram and TikTok companies; schedules, failed publishes and newly connected accounts show at the same companies.
> **Status:** receiver built (`/ingest/animora/<id>`, feed puller for `animora` integrations). Pending its first production run. Local both-sides check: skill `.claude/skills/animora-integration/`.

---

## Task: connect Animora to Brain Town

Repo: Animora (the naskah-to-video Python worker and the Go `server`) · Receiver: `https://town.example` (your Brain Town host)

Brain Town shows Animora's work as it happens: a video leaving the Video Generator when it is rendered, then arriving at the vendor company where it is published. Animora has to tell Brain Town when that happens. Two ways are supported; build both. Brain Town never calls the senders back, it only reads the public feed.

One Brain Town integration (kind `animora`) per Animora deployment. Both senders, the naskah-to-video worker and the Go `server`, use the **same** integration id and bearer token.

## Part 1: a push from both senders

### Configuration

Names only; values live in each service's deploy secrets and are never committed.

| Service | Setting | Example | Notes |
| --- | --- | --- | --- |
| naskah-to-video | `ANIMORA_NV_BRAIN_TOWN_ENABLED` | `true` | `true`/`false`. When off, nothing is sent. |
| naskah-to-video | `ANIMORA_NV_BRAIN_TOWN_URL` | `https://town.example/ingest/animora/<integration-id>` | The full ingest URL, including the id. https only. |
| naskah-to-video | `ANIMORA_NV_BRAIN_TOWN_TOKEN` | `bt_live_...` | Sent as `Authorization: Bearer <token>`. |
| server (Go) | `ANIMORA_BRAIN_TOWN_ENABLED` | `true` | Same meaning as above. |
| server (Go) | `ANIMORA_BRAIN_TOWN_URL` | `https://town.example/ingest/animora/<integration-id>` | Same integration as the worker. |
| server (Go) | `ANIMORA_BRAIN_TOWN_TOKEN` | `bt_live_...` | Same token as the worker. |

The URL and token come from the Brain Town back-office, Integrations, Animora.

### Request

```http
POST /ingest/animora/<integration-id>
Authorization: Bearer bt_live_...
Content-Type: application/json
Idempotency-Key: <event id>
```

`Idempotency-Key` is optional; it defaults to the body `id`. The body is at most 64 KiB; the senders keep it under 4 KiB.

```json
{ "id": "video-<code>", "type": "video.rendered", "at": "2026-11-23T09:14:03Z", "data": { } }
```

- `id`: at most 128 characters, stable across retries (the shapes below).
- `type`: one of the five types below.
- `at`: UTC, RFC 3339.

### When to send

| Moment | `type` | `id` | `data` (`*` = required) |
| --- | --- | --- | --- |
| A video finishes rendering | `video.rendered` | `video-<code>` | `title`*, `channel`, `language`, `duration` (number, seconds), `format` (`video` or `reel`) |
| A publish is scheduled on a vendor | `video.scheduled` | `plan-<video>-<channel>-<vendor>-sched` | `vendor`*, `channel`, `title`*, `dueAt`* (RFC 3339) |
| A video is live on a vendor | `video.published` | `video-<code>-<vendor>-<external_id>` | `vendor`*, `channel`, `title`*, `url`* (https), `publishedAt` (RFC 3339) |
| A publish attempt failed | `video.publish_failed` | `plan-<video>-<channel>-<vendor>-fail<N>` | `vendor`*, `channel`, `title`* |
| A kanal connects a vendor account | `channel.connected` | `chan-<channel>-<vendor>-<connected_at unix>` | `vendor`*, `channel`*, `account` |

```json
{
  "id": "video-a1b2c3-youtube-dQw4w9WgXcQ",
  "type": "video.published",
  "at": "2026-11-23T09:14:03Z",
  "data": { "vendor": "youtube", "channel": "Kanal Cerita", "title": "Kancil and the crocodiles",
            "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "publishedAt": "2026-11-23T09:14:00Z" }
}
```

### Field rules

- `vendor` is one of `youtube`, `facebook`, `instagram`, `tiktok`; anything else is `422` with `field` `data.vendor`.
- A missing required field is `422` with `field` `data.<name>` (for example `data.title`); a bad timestamp names its field (`data.dueAt`, `data.publishedAt`).
- Strings are trimmed and capped: `title` 200, `channel` and `account` 120, `url` 512, `language` 16 characters.
- `url` must be https, otherwise `422` `data.url`.
- `format` outside `video`/`reel` is dropped. An `account` that contains `@` is dropped (no emails).
- `channel` is the kanal's **public** display name; `account` is the connected platform account's **public** display name.
- Only the fields in the table are kept; anything else in `data` is dropped by Brain Town. Never send the prompt, the script (naskah) or failure text.
- Private and `nonaktif` videos are never sent.

### Responses from Brain Town

| Status | Meaning |
| --- | --- |
| `202` | Accepted. |
| `409` | This `Idempotency-Key` (else `id`) was already accepted. Treat as delivered. |
| `401` | Token missing or wrong, or unknown integration. |
| `422` | Body failed validation. The JSON body is `{"error": "...", "field": "..."}`. |
| `429` | Rate limited. Wait for `Retry-After` and retry. |

The senders treat any `2xx` and `409` as delivered.

### Delivery rules

- Never fail or block a job: send from the background, after the state change is committed.
- https only, no redirects followed, 3 second timeout, body at most 4 KiB.
- Bounded retry: up to 3 attempts on a network error, `5xx` or `429`; no retry on any other `4xx`.
- The token is never logged, nor put in an error message.

## Part 2: a feed Brain Town can pull

Needs no secret and catches anything a push lost.

- The Animora `server` exposes a public `GET /feed.json` (JSON Feed 1.1, no auth), newest first, at most 50 items.
- It is an allowlist projection: only published videos, never private or `nonaktif` ones, and only the fields below.

```json
{
  "version": "https://jsonfeed.org/version/1.1",
  "title": "Animora",
  "home_page_url": "https://animora.example/",
  "feed_url": "https://animora.example/feed.json",
  "items": [
    { "id": "video-a1b2c3-youtube-dQw4w9WgXcQ", "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "title": "Kancil and the crocodiles", "date_published": "2026-11-23T09:14:00Z",
      "_animora": { "vendor": "youtube", "channel": "Kanal Cerita", "code": "a1b2c3" } }
  ]
}
```

- Item `id` is the same `video-<code>-<vendor>-<external_id>` as the `video.published` push, so the two paths dedupe each other.
- `_animora.vendor` is required (one of the four vendors); `channel` is the public kanal name; `code` is the video code.

On the Brain Town side, set the integration's `feedUrl` (PATCH `/api/admin/integrations/{id}`) to the https URL of that feed. The puller checks it every 5 minutes (`FEED_PULL_INTERVAL_SECONDS`) and records each new item as `video.published` with `id` = item id and `data` `{vendor, channel, title, url, publishedAt = date_published}`. Items without a valid `_animora.vendor` are skipped.

## In the town

| Event | What happens |
| --- | --- |
| `video.rendered` | Work moves through the Video Generator, from production to ready. |
| `video.published` | The video arrives at the company of its `vendor` (YouTube, Facebook, Instagram or TikTok). |
| `video.scheduled` | A scheduled plan appears at that vendor's company. |
| `video.publish_failed` | That plan is marked failed (no failure text is shown). |
| `channel.connected` | Activity at that vendor's company. |

Animora has no Facebook, Instagram or TikTok uploader yet, so those companies only get `channel.connected`, `video.scheduled` and `video.publish_failed` today.

## Privacy and masking

- Brain Town stores a rebuilt event, never the raw body: `{"id","type","at","product":"animora","org":<the integration's org, if set>,"data":<allowlisted data>}`.
- Accepted events register the product `animora` (name "Animora", public, Sources label "Animora", default hall "Video Studio hall").
- On `/events` the frame is `{"seq","id","type","source":"animora","at","payload":{...}}`.
- If the product `animora` or its org is set to hidden in the back-office, the product and org are replaced by their aliases and `title`, `url`, `channel` and `account` (and `prompt`, `script`, `failure` if they ever appear) are removed from `data`. `vendor`, `dueAt`, `publishedAt`, `language`, `duration` and `format` stay.

## Done when

- [ ] With the `*_BRAIN_TOWN_ENABLED` settings off (or the URL/token unset), no request leaves either service.
- [ ] Rendering a test video produces exactly one `video.rendered` with `id` `video-<code>`.
- [ ] Publishing it to YouTube produces exactly one `video.published` whose `id` matches the item in `/feed.json`.
- [ ] Scheduling, a failed publish and connecting a vendor account each produce their event, with a `vendor` from the allowed list.
- [ ] A `409` from Brain Town is treated as delivered; a retried event carries the same `id`.
- [ ] With Brain Town unreachable, no render or publish job is slowed or failed.
- [ ] No body contains the prompt, the script, failure text, an email or a private/`nonaktif` video; the token never appears in logs.
- [ ] `/feed.json` returns JSON Feed 1.1 with `_animora.vendor` on every item and no private or `nonaktif` video.

## Try it by hand

```bash
curl -X POST "https://town.example/ingest/animora/<integration-id>" \
  -H "Authorization: Bearer bt_live_..." -H "Content-Type: application/json" \
  -d '{"id":"video-test1","type":"video.rendered","at":"2026-11-23T09:00:00Z","data":{"title":"Hello town","channel":"Kanal Cerita","language":"id","duration":42,"format":"video"}}'
```

`202` the first time, `409` when sent again. A video should leave the Video Generator in the town, and the delivery shows in the back-office event log.

## Automated check

The both-sides behaviour (push of every type, field validation, push+pull dedupe, masking, Brain Town down) is covered by the
E2E suite against the local stack: `e2e/tests/api/stream/integrations/animora/`
(`cd e2e && npm run test:local -- tests/api/stream/integrations`). The local both-sides run with Animora and the
read-only production check are in the skill `.claude/skills/animora-integration/SKILL.md`.

## As built

Pending the first production run. Record here the Animora version, the integration's `feedUrl`, and which events have
been seen live once they are.
