# AGENTS.md — rules for AI coding agents (e2e/)

> This file is the **single source of truth** for any AI agent that writes or changes code in `e2e/`. It is adopted from the
> Sismedika automation-test-project-template and adapted to Brain Town. The repository-level rule
> [`../.claude/rules/e2e-automation.md`](../.claude/rules/e2e-automation.md) is binding too; when this file and a prompt
> conflict on **policy** (section 6), this file wins — ask the human.

## 1. What this folder is

End-to-end test automation for Brain Town, **not** product code. Playwright + TypeScript against the **local compose stack
only** (project `brain-town-e2e`, `http://127.0.0.1:18280`), plus k6 performance scripts:

- backend E2E: admin API (`tests/api/rest/admin/**`) and ingest (`tests/api/rest/ingest/**`)
- SSE streams (`tests/api/stream/**`): subscribe to `/events` or `/admin/events`, trigger via REST, assert the pushed event
  with a bounded wait; the feed puller spec serves a JSON Feed from a local https fixture
- frontend E2E against the real backend: the town (`tests/web/town/**`) and the back-office (`tests/web/backoffice/**`)
- performance: k6 in `perf/`, run from Docker, **never** inside E2E specs

Demo (`town.demo.mfardiansyah.id`) and production (`town.mfardiansyah.id`) are never targets. `config/env.ts` refuses them.

## 2. Golden rules (non-negotiable)

1. In specs, import `test` and `expect` **only** from `@fixtures`.
2. Specs talk to the system **only** through API clients (`src/api/**`) and page objects (`src/web/**`). No raw `request.get()` or raw selectors in specs.
3. Every test is **independent**: creates its own data via factories, registers `cleanup.add(...)`, works in parallel and in any order.
4. **No sleeps.** Never `page.waitForTimeout()`, never `setTimeout` to wait. Use web-first assertions, `expect.poll` or the SSE client's bounded `waitFor`.
5. **No secrets, real PII or production URLs** anywhere in the repo, logs, test titles or fixtures. Only `*.example` env files are committed.
6. Never weaken a test to make it pass (delete assertions, broaden regexes, raise timeouts, add `force: true`, add retries). Find the cause.
7. Keep the folder mirror: `src/<layer>/<service|endpoint|app>/` ↔ `tests/<layer>/<service|endpoint|app>/`.
8. Run the checks in section 3 and report the real result. Do not claim tests pass if you did not run them.
9. **After any local E2E or perf run, shut the local deployment down** (`npm run stack:down`) and confirm nothing from
   `brain-town-e2e` is left. The `test:local`, `perf:local` and `check:all` scripts do it for you, also on failure.

## 2a. Test catalog & levels

- What to test lives in `docs/test-catalog/` (epics → stories → `+`/`-` test cases with status); concepts, levels and ID rules are in `docs/test-strategy.md`.
- Every new or changed test maps to a `TC-<EPIC>-NNN` row: add or update it (status, `Done`, spec path) and run `npm run catalog`. Put the TC id in the test title.
- This folder holds API-level and E2E tests only; unit tests live in `backend/` (Go). Agent roles and models: `../.claude/rules/agents-and-models.md`.

## 3. Commands

```bash
npm ci && npx playwright install chromium && npm run env:init   # setup (once); env:init generates random local passwords
npm run check                                   # typecheck + lint + format + catalog — MUST pass
npm run test:local                              # stack up → whole suite → stack down (always)
npm run test:local -- <path/to/file.spec.ts>    # run what you changed, same lifecycle
npm run test:local -- --repeat-each=3           # new/changed tests must pass 3× in a row
npm run perf:local                              # stack up (raised ingest limits) → k6 → stack down
npm run stack:up / stack:down / stack:status    # manual lifecycle; ALWAYS finish with stack:down
npm run catalog                                 # validate docs/test-catalog (ids, statuses, spec links)
npm run catalog:report                          # refresh the coverage table
```

With a stack you started by hand, plain `npx playwright test ...` works and leaves the stack running — then run
`npm run stack:down` yourself.

## 4. Project map — where code goes

| You are adding…               | Put it in                                                                      | Notes                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| A config value / URL          | `config/env.ts` (zod schema) + `env/.env.local.example`                        | Never read `process.env` elsewhere                                         |
| A new service / stream / page | `config/targets.ts` registry                                                   | Everything is one origin (`BRAIN_TOWN_URL`)                                |
| REST calls                    | `src/api/rest/<service>/<service>.client.ts`                                   | Extends `BaseApiClient`, returns `APIResponse`                             |
| Response contracts            | `src/api/rest/<service>/<service>.schemas.ts`                                  | zod schemas + inferred types                                               |
| SSE client                    | `src/api/stream/events/events.client.ts`                                       | `SseConnection`: `connect`, `waitFor`, `events`, `close`                   |
| A page                        | `src/web/<app>/pages/<page>.page.ts`                                           | Extends `BasePage`                                                         |
| App entry object              | `src/web/<app>/<app>.app.ts` + fixture in `src/fixtures/web.fixtures.ts`       |                                                                            |
| API / stream / feed fixtures  | `src/fixtures/api.fixtures.ts`                                                 | `adminApi`, `ingestApi`, `integration`, `sse`, `feed`, `cleanup`           |
| Payload builders              | `src/data/factories/<entity>.factory.ts`                                       | Valid by default, unique values, real emitter shapes                       |
| Known app bugs                | `src/utils/known-bugs.ts`                                                      | Used with `test.fail(true, KnownBug.x)`                                    |
| Specs                         | `tests/api/rest/<service>/`, `tests/api/stream/<service>/`, `tests/web/<app>/` | `<feature>.spec.ts`                                                        |
| Login session setup           | `tests/setup/<app>.setup.ts`                                                   | Writes `.auth/<app>.json`                                                  |
| Stack wiring                  | `scripts/stack.sh`, `compose.e2e.yml`, `feed-fixture/`                         | e2e-only override of `../compose.yml`; never change prod compose for tests |
| Performance                   | `perf/*.js` (k6), `perf/run.sh`, `perf/README.md`                              | Baseline numbers in `perf/README.md`                                       |

## 5. Coding standards

### 5.1 TypeScript

- `strict` is on; no `any` (use `unknown` + zod), no `@ts-ignore`. `!` non-null assertion only right after an assertion that proves it.
- Use path aliases (`@api/*`, `@web/*`, `@config/*`, `@data/*`, `@utils/*`, `@fixtures`); no `../../` in specs.
- `async/await` everywhere; every Playwright call is awaited (ESLint `no-floating-promises` is an error).
- Payload/request shapes: `type`/`interface`. Responses: zod schema → `z.infer`.
- Small, named functions; no commented-out code; comments explain **why**, not what.

### 5.2 Test structure

- One behaviour per test. Title = expected behaviour in present tense plus the TC id: `'a wrong token is refused (401) (TC-ING-030)'`.
- `test.describe('<service|app> · <area>')`. Arrange → Act → Assert, separated by a blank line; use `test.step()` for multi-step flows.
- Data-driven tests: a typed array + `for … of` creating one `test()` per row.
- No `if`/`switch`/ternaries inside tests (ESLint `no-conditional-in-test`). Branching means two tests.
- No shared mutable state between tests, no `test.describe.serial` unless a human approves.

### 5.3 REST API tests

- Assert **status + contract** with `expectJson(response, Schema, status)`; errors with `expectError(response, status, field?)`
  (Brain Town's envelope is `{ error, field? }`); `expectStatus` when there is no body.
- Per endpoint cover: happy path, auth (401), validation (400/415/422), not found (404), business rules (409/429).
- Assert on the `field` of a 422/409, not on the human-readable message.

### 5.4 Stream (SSE) tests

- Subscribe **first** (`sse.connect` resolves once the server is subscribed), then trigger through the REST client, then
  assert the pushed payload with `waitFor` / `waitForJson` (always bounded).
- Match events by the test's own unique ids; parallel workers share the stream.
- Proving that something is **not** pushed: send a later event and wait for it — the hub delivers in order.

### 5.5 Web tests & page objects

- Page objects expose **locators as readonly fields** and **user intentions as methods**; no business assertions, only `expectLoaded()`.
- Frontend tests: **arrange via API → act in UI → assert in UI and via API**.
- Tests that test login start with `test.use({ storageState: { cookies: [], origins: [] } })`; everything else reuses the setup session.

### 5.6 Locators (priority order)

1. `getByRole(role, { name })` 2. `getByLabel` 3. `getByPlaceholder` 4. `getByText` 5. `getByTestId` (`data-testid`)

Forbidden: XPath, long CSS chains, `nth()`/`first()` to pick among identical elements without a stated reason.
If no good locator exists, add a `data-testid` to the page (`web/town/index.html`, or `src/backoffice.src.html` then
`scripts/embed-tasks.sh`) instead of writing a brittle selector.

### 5.7 Waiting & assertions

- Web-first assertions: `await expect(locator).toBeVisible() / toHaveText() / toHaveCount()`.
- Backend eventual consistency: `await expect.poll(fn, { message }).toBe…`.
- Never `waitForTimeout`, `waitForLoadState('networkidle')`, `force: true`, or timeouts above the config defaults. A per-wait
  timeout above the default is allowed only with a written reason (the feed spec waits up to 20 s for the puller).

### 5.8 Test data

- Build payloads with factories (`buildGaosTask()`, `buildQaRun()`, `buildSiteVisit()`, `buildFeedItem()`); override only what the test cares about.
- Unique values via `uniqueId(scope)` — they start with `e2e-`.
- Register cleanup **immediately** after creating something; the `integration` fixture deletes its integration itself.
- Orgs and products cannot be deleted through the API: use unique keys so nothing another test owns is touched.

### 5.9 Tags

`Tag.smoke` (P0, critical path) · `Tag.regression` (P1/P2) · `Tag.destructive` (changes shared records such as settings; must
call `skipUnlessDestructiveAllowed()`) · `Tag.quarantine` (needs a ticket). Use the constants from `@utils/tags`.

## 6. Coding policy

### 6.1 Security & privacy

- Never write real credentials, tokens, cookies or personal data — not in code, comments, fixtures, snapshots or commit messages.
- `env/.env.local` holds random local passwords generated by `npm run env:init`; never paste it into prompts, PRs or issues.
- New config that can hold a secret → add the key to `env/.env.local.example` with `__FROM_PASSWORD_MANAGER__`.

### 6.2 Environment safety

- The only target is the local stack. Never add a demo or production URL, never weaken the guard in `config/env.ts`.
- Never ssh anywhere or touch other compose projects or containers from this suite.
- **Always shut the local stack down after a run** (golden rule 9).
- No load/performance loops in E2E tests; a bounded burst for the rate-limit check is fine.

### 6.3 Scope of changes

| You may change freely                                              | Needs explicit human approval (ask first)                                                                                                                                   | Never                                                                                          |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Specs, page objects, API clients, schemas, factories, catalog rows | `playwright.config.ts`, `config/**`, `src/fixtures/**`, `src/api/core/**`, `scripts/**`, `compose.e2e.yml`, `eslint.config.mjs`, `tsconfig.json`, `package.json`, this file | Commit secrets, disable lint rules globally, target demo/prod, push to `main`, rewrite history |

- Keep diffs focused on the task; changing a shared building block (client, fixture, page object) → run every spec that uses it.

### 6.4 Dependencies

- Do not add npm packages without approval. The SSE client is dependency-free on purpose (Node `fetch` streaming).
- k6 runs only from the pinned Docker image built by `perf/Dockerfile`; do not install k6 on the host or as an npm package.

### 6.5 Failing & flaky tests

- First reproduce, then read the trace (`npx playwright show-trace`), then fix the root cause (test bug, app bug, data, environment).
- If the **application** is wrong, do not change the expectation — mark `test.fail(true, KnownBug.<name>)` with the bug described
  in `src/utils/known-bugs.ts` and the catalog, and tell the human. Remove the marker in the PR that fixes the bug.
- Do not increase `retries` or timeouts to hide flakiness.

### 6.6 Reporting back

State exactly: what you changed (files), which commands you ran and their real results, that the stack is down, what you could not run, and open questions.

## 7. Recipes

### 7.1 Add tests for an existing endpoint

1. Add/extend the method in `src/api/rest/<service>/<service>.client.ts` and the zod schema.
2. Add or extend a factory if the endpoint takes a payload.
3. Write specs (happy path + 401 + 400/415/422 + 404 + 409/429), add catalog rows.
4. `npm run check`, then `npm run test:local -- <file> --repeat-each=3`.

### 7.2 Add a stream (SSE) test

1. Use the `sse` fixture (`connect('public' | 'admin')`); every connection is closed after the test.
2. Specs in `tests/api/stream/events/<feature>.spec.ts`: subscribe first, trigger via REST, assert with a bounded wait.
3. `npm run check`; run the file 3×.

### 7.3 Add a page object

1. Pick locators per 5.6; add `data-testid` to the page if needed.
2. `src/web/<app>/pages/<page>.page.ts` extending `BasePage`, wired into `<app>.app.ts`.
3. Specs in `tests/web/<app>/`: arrange via API, act in UI, assert UI + API.

### 7.4 Add or change a perf scenario

1. k6 script in `perf/`, shared helpers in `perf/lib.js`, thresholds in `options`.
2. `npm run perf:local`; record the result and the date in `perf/README.md`.

### 7.5 Fix a failing test

Follow 6.5. Open the trace from `test-results/` with `npx playwright show-trace <trace.zip>`. Report the root cause in one sentence.

## 8. Definition of done

- [ ] Code is in the right folder (section 4) and follows sections 5–6
- [ ] `npm run check` passes
- [ ] New/changed specs pass 3× locally (`npm run test:local -- --repeat-each=3`)
- [ ] Catalog row added/updated (status, spec link); `npm run catalog` passes
- [ ] Data created by tests is unique and cleaned up
- [ ] No secrets/PII/prod URLs; only `*.example` env files touched
- [ ] The local stack is down (`docker ps -a --filter name=brain-town-e2e` is empty)
- [ ] README / this file updated if a convention changed
- [ ] Summary for the human: files changed, commands run + results, anything not verified
