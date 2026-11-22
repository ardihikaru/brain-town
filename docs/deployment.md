# Deployment

Brain Town v1 is two static HTML files. Anything that serves files can host it. This repo
ships a small container and documents the author's own setup as a worked example.

## Local

```bash
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

- Image: `nginx:1.30.7-alpine3.24`, read-only root filesystem, 64 MB memory cap.
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
  Unknown hosts get `444`. `/` keeps buffering off and a long read timeout, ready for the
  planned SSE `/events`.
- **App host:** this repo is checked out to `~/devel/projects/brain-town`, with `.env.demo` and
  `.env.prod` (mode 600, never committed). Containers bind only to the WireGuard address.
- **Database:** a shared ArcadeDB server with one database per tenant. Brain Town has its
  own database and its own user (not root). Prod gets `ARCADEDB_URL`, `ARCADEDB_DATABASE`,
  `ARCADEDB_USER` and `ARCADEDB_PASSWORD` through `.env.prod`. The static pages do not use
  them yet; the planned backend will.

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
