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
- `.claude/agents/` — lead-engineer, frontend-designer (Opus 5.5); frontend-engineer, backend-engineer,
  e2e-engineer (Sonnet 5.5); e2e-runner (Haiku 5.5, runs E2E/stress tests only).
  `.claude/skills/` — Emil Kowalski design/motion skills (vendored, see `UPSTREAM.md`).
- `backend/` — Go back-office service (ingest, admin API, SSE).
- `e2e/` — E2E (Playwright) and performance (k6) suite against the local stack only. Rules: `e2e/AGENTS.md`
  and `.claude/rules/e2e-automation.md`.

## Ground rules
- Frontend stays **no build step**: single HTML files, inline CSS/JS, no framework or bundler.
- Backend is Go, standard library first; keep the container within the 64 MB limit.
- Events are the only input to the town; document new event types in the `EVENT BUS` comment and `docs/`.
- Tokens (`bt_live_…`) and DB credentials live only in server-side env or CI secrets. Store token
  hashes only. Never commit `.env*` (except `.env.example`).
- Privacy: public content only; visit events carry page and two-letter country only.
- Hidden orgs/products must be masked server-side before any public output.

- **Frontend work always goes through `frontend-designer` / `frontend-engineer`; multi-step or parallel
  coding is coordinated by `lead-engineer`. Models are locked: Opus for analysis, Sonnet for coding.**
  See `.claude/rules/agents-and-models.md`.

## Run / test
- Static: `python3 -m http.server -d web 8080` → `/town/`, `/backoffice/`.
- Container: `docker compose up --build` (health: `/healthz`).
- Backend: `cd backend && go vet ./... && go test ./...`.
- E2E: `cd e2e && npm ci && npm run check && npm run test:local` (stack up → suite → stack down);
  new/changed specs `npm run test:local -- --repeat-each=3`; perf `npm run perf:local` (k6 in Docker).
- **After any local E2E or perf run, the local deployment is shut down** (`cd e2e && npm run stack:down`) and
  `docker ps -a --filter name=brain-town-e2e` shows nothing. Demo and production are never E2E targets.

## Git workflow
- **Always work in a git worktree**, PR, then delete the worktree. See
  `.claude/rules/worktree-and-pr.md`.
- Conventional Commits; PR title ends with the `(#N)` on merge.
