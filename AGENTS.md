# AGENTS.md

Guidance for AI coding agents (tool-neutral). The full guide is in [`CLAUDE.md`](CLAUDE.md);
human contribution rules are in [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Essentials
- Frontend: plain HTML/CSS/JS, no build step. Edit `src/backoffice.src.html`, keep
  `web/backoffice/index.html` in sync. Never edit `artifacts/`.
- Backend: Go in `backend/`, standard library first.
- Never commit secrets or `.env*` (except `.env.example`); store token hashes only.
- Mask hidden orgs/products server-side; no personal data in events.
- Test: `cd backend && go vet ./... && go test ./...`; run: `docker compose up --build`.

## Workflow (mandatory)
1. Create a git worktree per task: `git worktree add -b <type>/<name> ../brain-town-worktrees/<type>-<name> main`.
   Never edit in the main checkout.
2. Commit with Conventional Commits, push, open a PR with `gh pr create` filling every section of
   `.github/PULL_REQUEST_TEMPLATE.md`.
3. Once the PR is created, remove the worktree: `git worktree remove <path>`.

Details: `.claude/rules/worktree-and-pr.md`.
