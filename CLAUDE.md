# Brain Town — agent guide

Brain Town is a "town" page that visualises events from GAOS, the QA tool and mfardiansyah.id,
plus a back-office to manage integrations, tokens, products and visibility.
Read `README.md`, `CONTRIBUTING.md` and `docs/architecture.md` first. Rules in `.claude/rules/`
are binding.

## Layout
- `src/backoffice.src.html` — back-office source (edit this).
- `web/town/index.html`, `web/backoffice/index.html` — served pages. The back-office page is
  `src/` plus the integration docs embedded at `/*__TASKS__*/`. Keep both in sync.
- `artifacts/` — frozen v1 package. Never edit.
- `docs/` — architecture, deployment, integration contracts (`docs/integrations/*.md`).
- `deploy/` — nginx image, site config, edge vhost reference (live edge config is on `clino`).
- `backend/` — Go back-office service (ingest, admin API, SSE). Added in a later PR.

## Ground rules
- Frontend stays **no build step**: single HTML files, inline CSS/JS, no framework or bundler.
- Backend is Go, standard library first; keep the container within the 64 MB limit.
- Events are the only input to the town; document new event types in the `EVENT BUS` comment and `docs/`.
- Tokens (`bt_live_…`) and DB credentials live only in server-side env or CI secrets. Store token
  hashes only. Never commit `.env*` (except `.env.example`).
- Privacy: public content only; visit events carry page and two-letter country only.
- Hidden orgs/products must be masked server-side before any public output.

## Run / test
- Static: `python3 -m http.server -d web 8080` → `/town/`, `/backoffice/`.
- Container: `docker compose up --build` (health: `/healthz`).
- Backend (once present): `cd backend && go vet ./... && go test ./...`.

## Git workflow
- **Always work in a git worktree**, PR, then delete the worktree. See
  `.claude/rules/worktree-and-pr.md`.
- Conventional Commits; PR title ends with the `(#N)` on merge.
