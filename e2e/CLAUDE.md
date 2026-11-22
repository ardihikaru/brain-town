@AGENTS.md

## Claude Code specifics

- Use plan mode before touching `playwright.config.ts`, `config/`, `src/fixtures/`, `scripts/` or `compose.e2e.yml` (shared framework code).
- Binding repository rule: `../.claude/rules/e2e-automation.md` (local stack only, always shut it down after a run).
- Agent roles and models for E2E work: `../.claude/rules/agents-and-models.md`.
- Personal, uncommitted notes go in `CLAUDE.local.md` (git-ignored).
