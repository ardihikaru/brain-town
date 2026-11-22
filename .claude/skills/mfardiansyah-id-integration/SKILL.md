---
name: mfardiansyah-id-integration
description: Check the mfardiansyah.id ↔ Brain Town integration (feed.json pull, article.published push, site.visit beacon, /office) end to end with both sides running locally, plus the one allowed read-only production check. Use when the site's Brain Town code or Brain Town's site receiver changes, or when asked whether the site's events reach the town.
---

# mfardiansyah.id ↔ Brain Town integration

Contract: `docs/integrations/mfardiansyah-id.md`. Site code (repo `mfardiansyah.id`, read-only here):
`backend/brain_town.go` (client), `brain_town_push.go` (push + retry scan), `brain_town_visit.go`
(beacon), `feed_json.go` (feed), design `docs/designs/brain-town.md`. The site has a matching skill,
`brain-town-integration`.

## Safety rules
- Local both sides. The receiver is the `brain-town-e2e` stack only. The site runs from a locally built
  binary with a **throwaway** ArcadeDB container and a random local admin password.
- Never run the site's `backend/db/apply.sh` (it ships to the production database over ssh). Apply the
  schema to the local container with plain `curl` as below.
- The site has no LinkedIn, AI, Hikaru, Animora or Redis env locally, so a local publish has no side
  effects. Never copy the site's production `.env`.
- Secrets live in files under a scratch directory (mode 600), never printed. `brain-town-e2e` is
  shared: check it is free before `up`, and only tear down a stack you started.

## Wiring (why it looks like this)
- The site only sends to an **https** `BRAIN_TOWN_URL`. A throwaway nginx (`--network host`) terminates
  TLS on `127.0.0.1:18443` with a cert for `IP:127.0.0.1` from a throwaway CA and proxies to
  `127.0.0.1:18280`. The site binary trusts that CA through `SSL_CERT_FILE` (Go reads it on Linux).
- The site api serves `/` only when `WEB_ORIGIN` is set: serve the repo's `site/` folder with
  `python3 -m http.server`.
- Pull: the Brain Town api container cannot reach the host. Copy the local site's `/feed.json` into
  the stack's https feed fixture (`e2e/.stack/feed/<name>.json`) and set the integration's
  `feedUrl` to `https://feed-fixture:8443/<name>.json`. This proves the real site feed through the
  real puller.
- No GeoIP file locally, so the site has no country for local visits (see "Known results").

## Run it (from a Brain Town worktree; `S` is a scratch directory)
```bash
S=<scratch>/intg; mkdir -p $S; umask 077
docker ps -a --filter label=com.docker.compose.project=brain-town-e2e   # must be empty (shared)
(cd e2e && bash scripts/stack.sh up)
(cd <site-repo>/backend && go build -o $S/site-api .)

# Throwaway site database
openssl rand -hex 16 > $S/arcade.pw; openssl rand -hex 12 > $S/admin.pw
docker run -d --name bt-intg-site-arcadedb -p 127.0.0.1:12480:2480 \
  -e JAVA_OPTS="-Darcadedb.server.rootPassword=$(cat $S/arcade.pw)" arcadedata/arcadedb:26.7.2
curl -s -u "root:$(cat $S/arcade.pw)" -d '{"command":"create database mfardiansyah"}' http://127.0.0.1:12480/api/v1/server
# then send each line of backend/db/schema.sql, migrations/*.sql and the seed.json UPSERTs (the same
# statements apply.sh builds) to http://127.0.0.1:12480/api/v1/command/mfardiansyah as {"language":"sql","command":…}.
# Expected errors: the SchemaVersion upserts before migration 004 and `LinkedinShare.trigger` (reserved word).

# TLS front (throwaway CA, cert for IP:127.0.0.1) → nginx: listen 127.0.0.1:18443 ssl; proxy_pass http://127.0.0.1:18280;
docker run -d --name bt-intg-tls --network host -v $S/nginx.conf:/etc/nginx/conf.d/default.conf:ro \
  -v $S/tls:/tls:ro nginx:1.30.7-alpine3.24

# Site integration on the e2e stack: admin login with e2e/env/.env.local (never printed),
# POST /api/admin/integrations {"kind":"site","name":"e2e-intg-…"} → keep .token and .ingestPath in files.

# Site api
ARCADEDB_URL=http://127.0.0.1:12480 ARCADEDB_DB=mfardiansyah ARCADEDB_USER=root ARCADEDB_PASSWORD=… \
SITE_URL=http://127.0.0.1:18121 LISTEN=127.0.0.1:18121 GRPC_LISTEN=off WEB_ORIGIN=http://127.0.0.1:18120 \
ADMIN_USER=admin ADMIN_PASSWORD=… ADMIN_BASIC_ENABLED=true SESSION_SECURE=false TRUSTED_PROXY_CIDRS=none \
SSL_CERT_FILE=$S/tls/ca.crt BRAIN_TOWN_ENABLED=true BRAIN_TOWN_URL=https://127.0.0.1:18443<ingestPath> \
BRAIN_TOWN_TOKEN=… $S/site-api
python3 -m http.server 18120 --bind 127.0.0.1 -d <site-repo>/site
```
Watch deliveries with `GET /api/admin/events?integration=<id>` (fields `delivery`, `status`, `raw`).

## Done when (expected local results)
| # | Action | Expect |
|---|---|---|
| 1 | `GET :18121/feed.json` | 200, `application/feed+json`, `max-age=300`, ≤20 EN items, `id=post-<slug>`, `_kind=article`, first tag `article` |
| 2 | Publish an EN note (`POST /api/admin/posts`, Basic auth, a seeded `category`, `status:"published"`, `publishedAt` now) | one `article.published`, `id=post-<slug>`, `data{title,url,to:"blog"}`, under a second |
| 3 | Save the note again (twice) | still one event |
| 4 | Same id pushed by hand | 409 |
| 5 | `GET /` and `/blog/<slug>` with a browser UA | one `site.visit` each, `page` home/blog, `title` only for blog, keys only `page,country,title` |
| 6 | Googlebot UA; `Sec-Purpose: prefetch`; cookie `mfs_admin` | nothing sent (prove with a later marker event via ingest) |
| 7 | `docker stop bt-intg-tls`, publish another note, open `/` | 201 and 200 at once; site logs "Brain Town is unreachable" |
| 8 | Front back, `feedUrl` → fixture copy of the site feed | the puller emits only ids not seen yet; the site's retry of a pulled id gets 409 and counts as delivered |
| 9 | `/office` | 200 |

## Known results (2026-11-23)
- Items 1–4, 6, 7, 9 passed with site v0.54.3. The push reached the stack in about 0.25 s.
- Item 5 failed on v0.54.3 when the site had no country: Brain Town requires a two-letter
  `data.country` (422, `field: data.country`) and the site omitted it. Fixed in the site (v0.54.4): no
  country → no beacon. Locally (no GeoIP file) item 5 therefore shows **no** event and no rejected
  delivery; the country path is covered by the site's unit tests and by production (below).
- Item 8 on v0.54.3: after the pull delivered an id, the site's retry got 409 and kept retrying until
  `failed`. Fixed in v0.54.4 (409 = delivered). Re-run on the fixed build: the retry hit 409, the site's
  `Notification` row (`dedupeKey braintown:<slug>`) became `sent` after one attempt, one event per id.
- Automating this as a Playwright spec needs approval-gated e2e wiring (a site URL in `e2e/config/env.ts`,
  an https front for the push in `e2e/compose.e2e.yml`, cert names in `e2e/scripts/stack.sh`). Not done;
  ask the user first.

## Clean up (always)
Stop `site-api` and the `http.server`; `docker rm -f bt-intg-tls bt-intg-site-arcadedb`;
`(cd e2e && bash scripts/stack.sh down)`; confirm `docker ps -a --filter name=brain-town-e2e` and
`docker ps -a --filter name=bt-intg` are empty; delete the scratch directory.

## Production read-only check (only when the user asks for it)
No writes, no test events, no ssh. Credentials (read with `jq`, never printed): Brain Town admin in
`~/.config/brain-town/admin.json` (`email`, `password`); the site integration in
`~/.config/brain-town/mfardiansyah.id.json`; the site's own admin login (`https://mfardiansyah.id/admin`)
in `~/.config/mfardiansyah.id/login.json` (`username`, `password`). The site login is not needed for the
read-only check; any use of it that publishes (a note, an auto-post run) is a production write and needs
the user's explicit go-ahead for that one run.
1. `curl https://mfardiansyah.id/feed.json` → 200, 20 items, ids `post-…`, newest first. `curl -o /dev/null -w '%{http_code}' https://mfardiansyah.id/office` → 200.
2. Log in to `https://town.mfardiansyah.id/api/admin/login` with a cookie jar in the scratch dir,
   `GET /api/admin/events?integration=site-312f4f&limit=200`, check `delivery`/`status`/`raw.data`, then
   `POST /api/admin/logout` and delete the jar.
3. 2026-11-23 result: home and blog `site.visit` (country ID) at 21:35:14Z, `cred-check-20261123`, and a
   later real home visit (SG), all `ok`/202, keys only `page,country,title`. No `article.published` yet:
   the live push has never fired; it is proven on the first real EN note publish.
