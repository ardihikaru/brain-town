# .claude/

Shared Claude Code configuration for this repo.

- `settings.json` — shared permissions (safe test/inspect commands allowed; `.env*` reads denied).
  Personal overrides go in `settings.local.json` (git-ignored).
- `rules/worktree-and-pr.md` — always use a git worktree; open a PR; delete the worktree after.
- `rules/backoffice.md` — conventions for the back-office frontend and Go backend.
- `rules/agents-and-models.md` — frontend work always goes through the agents; model lock
  (Opus 5.5 analysis, Sonnet 5.5 coding); lead-engineer coordinates multi-step and parallel work.
- `agents/` — `lead-engineer`, `frontend-designer` (Opus 5.5), `frontend-engineer`,
  `backend-engineer` (Sonnet 5.5).
- `skills/` — Emil Kowalski's design-engineering and motion skills, vendored verbatim (MIT).
  Source, pinned commit and re-sync steps: `skills/UPSTREAM.md`.

Top-level guides: `../CLAUDE.md`, `../AGENTS.md`.
