---
name: animora-integration
description: Check the Animora ↔ Brain Town integration (push from the naskah-to-video sender, public /feed.json pulled by Brain Town, masking, push+pull dedupe) end to end with the real Animora server and sender running locally against the e2e stack, plus the one allowed read-only production check. Use when Animora's Brain Town code or Brain Town's animora receiver changes, or when asked whether Animora's events reach the town.
---

# Animora ↔ Brain Town integration

Contract: `docs/integrations/animora.md`. Animora code (repo `animora`, read-only here): `naskah-to-video/app/braintown.py`
(the worker's sender, `python -m app.braintown send`), `server/internal/braintown/` and `server/internal/httpapi/braintown.go`
(the Go server's `channel.connected` push), `server/internal/httpapi/feed_routes.go` and `server/internal/store/feed.go`
(public `GET /feed.json`). Receiver: `backend/internal/animora/`, `backend/internal/ingest/`, `backend/internal/feed/`.

## Safety rules
- Local both sides. The receiver is the `brain-town-e2e` stack only. Animora's server runs on a **throwaway** database
  (`animora_e2e`) inside the stack's own ArcadeDB with a random API token; nothing real is read or written.
- The Animora repo is only read (`git archive`); never edit it, never copy its production env files.
- Secrets (the integration token, the server's API token) live in mode-600 files under `e2e/.stack/animora/` and are never
  printed; `stack down` deletes them. `brain-town-e2e` is shared: check it is free before `up` and only tear down a stack
  you started.
- Never POST to production. The production check below is read-only.

## Wiring (why it looks like this)
- Animora's sender only sends to **https** and Brain Town's puller only pulls **https**. `animora-front` (nginx, throwaway CA
  shared with the rest of the stack) answers two names: `animora-brain-town-tls` (sender → Brain Town's `web`) and
  `animora-pull-tls` (Brain Town's api → the real Animora server). The sender container trusts the CA through
  `SSL_CERT_FILE`, Brain Town's api already does.
- `scripts/stack.sh up` exports `server/`, `deploy/Dockerfile.server` and `naskah-to-video/app/` with `git archive` into
  `e2e/.stack/animora/src`, then (profile `animora`): `animora-init` creates the database, `animora-server` is built from
  the repo's own Dockerfile and migrates it, `animora-fixture/provision.mjs` creates the stack-owned Brain Town `animora`
  integration, seeds the server through its write API with a public, a **private** and a **nonaktif** published video and
  sets the integration's `feedUrl` to the real feed. `animora-sender` (python image, stdlib only) then runs the real
  `python -m app.braintown send` once per envelope (rendered, scheduled, published), **twice** each, and writes
  `delivered|failed` lines (no body, no token) to `e2e/.stack/animora/sender.log`.
- The published envelope carries the same id as the seeded video's feed item (`video-<code>-youtube-<external_id>`), so push
  and pull dedupe each other.
- Without the Animora repo/ref (or when the ref has no emitter yet) `up` warns, starts without these pieces and the
  both-sides specs skip with a reason. The contract specs push straight at the receiver and always run.

## Run it (from a Brain Town worktree)
```bash
docker ps -a --filter label=com.docker.compose.project=brain-town-e2e   # must be empty (shared)
cd e2e && npm ci && npm run check
# default source: the sibling "animora" of the main checkout, ref "main"; set both while the emitter is on a branch
ANIMORA_REPO_DIR=/path/to/animora ANIMORA_REF=feat/brain-town-emitter \
  npm run test:local -- --grep animora --repeat-each=3        # stack up -> specs -> stack down (always)
# by hand: ANIMORA_REPO_DIR=... ANIMORA_REF=... npm run stack:up ; npx playwright test tests/api/stream/integrations/animora ; npm run stack:down
```
Specs: `e2e/tests/api/stream/integrations/animora/` (catalog `e2e/docs/test-catalog/integrations.md`, TC-INTG-070 to 135).
Watch deliveries with `GET /api/admin/events?integration=<id>` (fields `delivery`, `status`, `raw`).

## Done when (expected local results)
| # | Contract item | Check | Spec |
|---|---|---|---|
| 1 | Disabled or unconfigured sender sends nothing | `python -m app.braintown send` prints `failed: not enabled` and exits 1 without a request (Animora's own `test_braintown.py`) | not in the suite |
| 2 | One `video.rendered`, id `video-<code>` | real sender delivers; one stored event with that id | TC-INTG-130, 131 |
| 3 | One `video.published` whose id matches the `/feed.json` item | stored once on the integration that also pulls the feed | TC-INTG-131, 134 |
| 4 | Scheduled / failed / connected carry a vendor from the list | contract push per type and per vendor | TC-INTG-071 to 074, 080 to 083 |
| 5 | `409` counts as delivered; a retried event has the same id | the sender's second pass is `delivered` | TC-INTG-090, 091, 130 |
| 6 | Brain Town unreachable never slows a job | covered by Animora's unit tests (background thread, 3 s timeout); not observable from here | not in the suite |
| 7 | No prompt, script, failure text, email or private/nonaktif video | allowlist and email drop; the real feed omits the flagged videos | TC-INTG-076, 077, 132, 133 |
| 8 | `/feed.json` is JSON Feed 1.1 with `_animora.vendor` on every item | real server feed, strict schema | TC-INTG-132 |
| 9 | Brain Town pulls the feed; items without a valid vendor are skipped | real feed and fixture feed | TC-INTG-120, 121, 133 |
| 10 | Hidden org/product masks title, url, channel, account; keeps vendor and code | contract push with a hidden org / product | TC-INTG-110 to 112 |

## Known results
_None yet. Record here, with the date, the Animora ref and the Brain Town commit, what each run showed._

## Clean up (always)
`(cd e2e && bash scripts/stack.sh down)` (or let `npm run test:local` do it); confirm
`docker ps -a --filter name=brain-town-e2e` and `docker volume ls --filter label=com.docker.compose.project=brain-town-e2e`
are empty, and that `e2e/.stack` is gone.

## Production read-only check (only when the user asks for it)
No writes, no test events, no ssh, never a POST. Credentials: the Brain Town admin login lives in
`~/.config/brain-town/admin.json` (`email`, `password`; read with `jq`, never printed); Animora's own logins are not needed.
1. `curl -s https://animora.mfardiansyah.id/api/feed.json` → 200, `application/feed+json`, `version` `https://jsonfeed.org/version/1.1`,
   at most 50 items, every item has `id` `video-<code>-<vendor>-<external_id>`, https `url`, `date_published`, and
   `_animora.vendor` in `youtube|facebook|instagram|tiktok`. Check the **shape only**; do not store titles or links anywhere.
2. Log in to `https://town.mfardiansyah.id/api/admin/login` with a cookie jar in the scratch directory,
   `GET /api/admin/integrations` to find the `animora` integration id (and its `feedUrl`),
   `GET /api/admin/events?integration=<id>&limit=200`: look at `delivery`, `status`, `type` and the key names of `raw.data`
   (no `prompt`, `script`, `failure`, no `@`), then `POST /api/admin/logout` (a session end, not a data write) and delete the jar.
3. Record the result under "Known results" (date, counts, which types were seen live), nothing else.
