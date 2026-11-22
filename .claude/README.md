# .claude/

Shared Claude Code configuration for this repo.

- `settings.json` — shared permissions (safe test/inspect commands allowed; `.env*` reads denied).
  Personal overrides go in `settings.local.json` (git-ignored).
- `rules/worktree-and-pr.md` — always use a git worktree; open a PR; delete the worktree after.
- `rules/backoffice.md` — conventions for the back-office frontend and Go backend.

Top-level guides: `../CLAUDE.md`, `../AGENTS.md`.
