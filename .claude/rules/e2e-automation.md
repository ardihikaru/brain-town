# E2E automation rule (binding)

The E2E and performance suite lives in `e2e/` (Playwright + TypeScript, k6 from Docker), adopted from the Sismedika
automation-test-project-template. Full rules: `e2e/AGENTS.md`. This file is the short, repo-wide version.

## Golden rules
1. Specs import `test` and `expect` only from `@fixtures`.
2. Specs use API clients (`e2e/src/api/**`) and page objects (`e2e/src/web/**`) only: no raw requests or selectors.
3. Every test is independent: its own data via factories and `uniqueId()`, `cleanup.add(...)` right after creating
   anything, parallel-safe and order-free.
4. No sleeps: web-first assertions, `expect.poll`, or the SSE client's bounded `waitFor`.
5. No secrets, real personal data or demo/production URLs anywhere. Only `*.example` env files are committed;
   `e2e/env/.env.local` is generated with random local passwords and git-ignored.
6. Never weaken a test to make it pass. If the app is wrong, keep the assertion, mark `test.fail(true, KnownBug.x)`
   (`e2e/src/utils/known-bugs.ts`), record it in the catalog and report it.
7. Never claim a test passed without running it; report the real counts.

## Structure and naming
- Folder mirror `e2e/src/<layer>/<service|app>/` ↔ `e2e/tests/<layer>/<service|app>/`; specs are `<feature>.spec.ts`.
- Every test maps to a `TC-<EPIC>-NNN` row in `e2e/docs/test-catalog/` (id in the title); tags from `@utils/tags`
  (`smoke` = P0, `regression` = P1/P2, `destructive` for shared records such as settings).
- Approval-gated files (ask first): `e2e/playwright.config.ts`, `e2e/config/**`, `e2e/src/fixtures/**`,
  `e2e/src/api/core/**`, `e2e/scripts/**`, `e2e/compose.e2e.yml`, `e2e/eslint.config.mjs`, `e2e/tsconfig.json`,
  `e2e/package.json`, `e2e/AGENTS.md`.

## Targets: local only
- The only target is the local compose stack `brain-town-e2e` on `127.0.0.1:18280` (`e2e/scripts/stack.sh`).
  `town.mfardiansyah.id` and `town.demo.mfardiansyah.id` are never targets; `e2e/config/env.ts` refuses them.
- E2E-only wiring goes in `e2e/compose.e2e.yml`, never in the production `compose.yml`.
- Never ssh anywhere and never touch other compose projects or containers from the suite.

## Always shut the local deployment down
**After any local E2E or perf run — passed, failed or interrupted — shut the local deployment down with
`e2e/scripts/stack.sh down` (`npm run stack:down`, which runs
`docker compose -p brain-town-e2e down -v --remove-orphans`), and confirm with
`docker ps -a --filter name=brain-town-e2e` and `docker volume ls` that nothing from `brain-town-e2e` is left.**
`npm run test:local`, `npm run perf:local` and `npm run check:all` do this through a `trap`, also on failure or Ctrl-C.
A stack started by hand with `npm run stack:up` must be shut down by hand.

## Performance
- Only through k6 in `e2e/perf/`, run from the pinned Docker image (`npm run perf:local`); never inside E2E specs and
  never against demo or production. Record new baselines in `e2e/perf/README.md`.

## Definition of done
- `cd e2e && npm run check` passes (typecheck, lint, format, catalog).
- New or changed specs pass 3× in a row: `npm run test:local -- --repeat-each=3`.
- Catalog rows updated; test data unique and cleaned up; the local stack is down.

Agent roles and models for E2E work: see `.claude/rules/agents-and-models.md`.
