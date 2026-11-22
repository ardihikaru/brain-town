# Deployment

Brain Town is two static HTML files plus a small Go service (`backend/`) for the back-office
API, ingest and SSE. The pages alone can be hosted anywhere (the back-office then runs on
sample data); the service is needed for real integrations. This repo ships both containers and
documents the author's own setup as a worked example.

## Local

```bash
cp .env.example .env          # set ADMIN_EMAIL and ADMIN_PASSWORD
docker compose up --build     # http://127.0.0.1:8080  and  /backoffice/
```

Without Docker: `python3 -m http.server -d web 8080`, then open `/town/` and `/backoffice/`.

## The container

| Path | Serves |
| --- | --- |
| `/` | `web/town/index.html` |
| `/backoffice` | 301 to `/backoffice/` |
| `/backoffice/` | `web/backoffice/index.html` |
| `/healthz` | `200 ok` |

- `/api/`, `/ingest/`, `/events` and `/admin/events` are proxied to the `api` service (port
  8081, not published). SSE is unbuffered with a 1 h read timeout. If `api` is down the pages
  still serve and the back-office falls back to sample data.
- Image: `nginx:1.30.7-alpine3.24`, read-only root filesystem, 64 MB memory cap.
- `api`: static Go binary on `scratch`, read-only root, 64 MB cap. Data lives in ArcadeDB
  (`ARCADEDB_*`, see `.env.example`). It refuses to start without `ADMIN_EMAIL` and
  `ADMIN_PASSWORD`, and in `prod` mode without `ARCADEDB_URL`.
- Locally, `docker compose --profile db up --build` also runs an ArcadeDB container. Production
  uses the existing ArcadeDB and does not run that service.
- The edge vhost must forward `/ingest/`, `/events`, `/admin/events` and `/api/` to the same
  upstream and must not buffer `/events` (`proxy_buffering off`).
- HTML is sent with `Cache-Control: no-cache`, so a redeploy shows at once.
- TLS and the public hostname belong to the reverse proxy in front.

`compose.yml` runs one project per environment, each with its own env file:

```bash
cp .env.example .env.demo   # edit
ENV_FILE=.env.demo docker compose -p brain-town-demo --env-file .env.demo up -d --build
```

## The author's deployment (worked example)

| Environment | URL | Container | Database |
| --- | --- | --- | --- |
| demo | https://town.demo.mfardiansyah.id (+ `/backoffice/`) | `brain-town-demo`, host port `19202` | none (simulator only) |
| prod | https://town.mfardiansyah.id (+ `/backoffice/`) | `brain-town-prod`, host port `18202` | ArcadeDB, database `braintown`, user `braintown` |

```
 internet ─▶ edge (nginx 1.30.7, TLS, Let's Encrypt) ─WireGuard─▶ app host: brain-town-{demo,prod} containers
                                                                     │
                                                                     └─WireGuard─▶ db host: shared ArcadeDB (:2480)
```

- **Edge vhost:** [`deploy/edge/brain-town.conf`](../deploy/edge/brain-town.conf) is a reference
  copy. Each hostname has its own certificate lineage (`brain-town`, `brain-town-demo`).
  Unknown hosts get `444`. `/` keeps buffering off and a long read timeout, so the SSE streams
  `/events` and `/admin/events` stay open. Rate limits: pages and API 20 r/s per client IP
  (burst 60); `/ingest/` 100 r/s (burst 300), because platform servers may send in batches.
- **App host:** this repo is checked out to `~/devel/projects/brain-town`, with `.env.demo` and
  `.env.prod` (mode 600, never committed). Containers bind only to the WireGuard address.
- **Database:** a shared ArcadeDB server with one database per tenant. Brain Town has its
  own database and its own user (not root). Prod gets `ARCADEDB_URL`, `ARCADEDB_DATABASE`,
  `ARCADEDB_USER` and `ARCADEDB_PASSWORD` through `.env.prod`; the `api` service reads them.
  Demo leaves them empty and keeps events in memory only (they reset on restart).
- **Admin login and limits:** `.env.demo` and `.env.prod` also need `ADMIN_EMAIL` and
  `ADMIN_PASSWORD`. `INGEST_RATE` / `INGEST_BURST` (default 50 per second, burst 200) bound each
  integration; above that the API answers `429` with `Retry-After` and senders retry.

### Redeploy after merging to `main`

```bash
cd ~/devel/projects/brain-town && git pull --ff-only
ENV_FILE=.env.demo docker compose -p brain-town-demo --env-file .env.demo up -d --build
ENV_FILE=.env.prod docker compose -p brain-town-prod --env-file .env.prod up -d --build
curl -fsS http://<bind-addr>:19202/healthz && curl -fsS http://<bind-addr>:18202/healthz
```

### Check

```bash
curl -sI https://town.demo.mfardiansyah.id/ | head -1             # 200
curl -sI https://town.demo.mfardiansyah.id/backoffice | grep -i ^location   # /backoffice/
curl -sI https://town.mfardiansyah.id/backoffice/ | head -1       # 200
```

## Go-live checklist for the three integrations
Tokens are created in the back-office and passed only through the operator's own secret channel. Never commit them.

1. In the back-office create three integrations (`site`, `gaos`, `qa`) and the products they will send (QA keys such as `sipreport`, `hisv3`; GAOS `p-6`). Set the site integration's feed URL to `https://mfardiansyah.id/feed.json`.
2. Copy each ingest URL and one-time token to its emitter:
   - mfardiansyah.id: `BRAIN_TOWN_ENABLED`, `BRAIN_TOWN_URL`, `BRAIN_TOWN_TOKEN` in `.env` on clinodb (mode 600), then `docker compose up -d`.
   - GAOS (rnd-v3-vpn): token into `deploy/stacks/prod.bt-token` (mode 600), plus `BRAIN_TOWN_ENABLED`, `BRAIN_TOWN_URL`, `BRAIN_TOWN_PUBLIC_PRODUCTS` on the redeploy line.
   - QA tool (rnd-v3): `BRAIN_TOWN_URL`, `BRAIN_TOWN_TOKEN`, `BRAIN_TOWN_PRODUCTS` in `~/.config/qa-automation/playwright-executor.env`, then `systemctl --user restart playwright-executor`.
3. Check each path: move a GAOS card, run one QA case, publish a throwaway note and open `/`. Each should show in the town and in the back-office events page.
4. GAOS on `vm-rnd-ardi` is not upgraded yet; it needs back-office sign-in accounts first.
