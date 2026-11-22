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

## Roles and models (mandatory)
Role briefs are in `.claude/agents/`, design/motion skills in `.claude/skills/*/SKILL.md` (plain
markdown, Emil Kowalski, MIT). Full rule: `.claude/rules/agents-and-models.md`.
- Analysis, planning, design and review run on the strongest reasoning model (Claude: Opus 5.5).
  Roles: lead engineer (coordinates all coding, including parallel workers), frontend designer.
- Coding runs on a Sonnet-class model (Claude: Sonnet 5.5). Roles: frontend engineer, backend engineer.
- Frontend work always follows designer spec → engineer → designer review. Project rules beat skill
  advice: no frameworks or npm libraries; CSS/WAAPI/vanilla JS; respect `prefers-reduced-motion`.
- Parallel work: one branch and worktree per unit under `.claude/worktrees/`, reviewed by the lead.

## Workflow (mandatory)
1. Create a git worktree per task: `git worktree add -b <type>/<name> .claude/worktrees/<type>-<name> main`
   (always inside this repo's git-ignored `.claude/worktrees/`, never elsewhere).
   Never edit in the main checkout.
2. Commit with Conventional Commits, push, open a PR with `gh pr create` filling every section of
   `.github/PULL_REQUEST_TEMPLATE.md`.
3. Once the PR is created, remove the worktree: `git worktree remove <path>`.
4. When the PR is merged, delete the branch every time: `gh pr merge <n> --squash --delete-branch`,
   then `git branch -D <branch>` and `git fetch --prune`. Only your own branches.
5. After every merge, update the local main checkout: `git checkout main && git pull --ff-only` (must
   be clean and equal to `origin/main`); pull on the server too when deploying.

Details: `.claude/rules/worktree-and-pr.md`.
