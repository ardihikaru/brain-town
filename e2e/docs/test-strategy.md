# Test strategy and QA concepts

Which QA concepts this repository follows, how test cases are documented, and which agent helps at which test level.
The checklist itself is the [test catalog](test-catalog/README.md). The rules for writing code are in [../AGENTS.md](../AGENTS.md).
Brain Town has one service (Go api behind nginx) and two pages; "cross-service" here means api → SSE → page.

## 1. Test levels (pyramid for services)

| Level           | What it checks                                                                   | Where it lives                                                                                     | Speed |
| --------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----- |
| **Unit**        | One function/class in isolation, dependencies mocked                             | **`backend/` Go tests** (`go test ./...`), not in `e2e/`                                           | ms    |
| **Integration** | One service with its real collaborators (DB, queue, auth) through its public API | `backend/` Go tests for deep integration; **`tests/api/**` here** for contract tests through nginx | s     |
| **E2E**         | A user journey across services and/or the UI, real backend                       | **`tests/web/**`, cross-service specs here**                                                       | s–min |

Stream specs (`tests/api/stream/**`) are API-level too: they subscribe to SSE/WebSocket and assert the pushed event. The feed puller spec (`tests/api/stream/events/feed-pull.spec.ts`) is API-level too: it serves a feed from a local https fixture and asserts the pushed event.

Rules of thumb: test each rule at the **lowest level that can show it**; keep E2E for journeys and contracts between
services. `e2e/` is E2E and API-level only. It has no unit-test runner; unit tests live in `backend/` (Go). Performance is measured
separately with k6 in `perf/`, never inside E2E specs.

## 2. Concepts used

- **Risk-based testing.** Every case gets a priority: `P0` revenue/security critical → `@smoke`, `P1` important → `@regression`,
  `P2` normal, `P3` edge. Automate P0/P1 first.
- **Traceability.** Epic → User story → Scenario → Test case → Spec. Stories follow INVEST ("As a … I want … so that …").
- **Scenarios in Given / When / Then.** Used as documentation in one line per case; there is no Cucumber/Gherkin runner.
- **Positive and negative cases.** Every behaviour needs `+` (it works) and `-` (it is refused correctly). Negative cases are
  derived with these techniques:
  - _Equivalence partitioning_ — one case per class of invalid input (missing, wrong type, empty, too long).
  - _Boundary value analysis_ — values at and around limits (retentionDays 0/1/3650/3651, id length 128/129, body 64 KiB).
  - _Decision / state transition_ — role × action matrix; allowed and forbidden state changes (rotate a token, then use the old one).
  - _Error guessing_ — duplicates, expired tokens, double submits, unknown ids.
  - REST checklist per endpoint (AGENTS.md §5.3): 401, 403, 400, 404, 409/422.
- **Independent, data-owning tests.** Each test creates and cleans its own data (AGENTS.md §2).
- **Shift-left.** Cases are written as catalog rows when the story is refined, before the spec exists.

## 3. IDs and statuses

| Item       | Pattern                        | Example       |
| ---------- | ------------------------------ | ------------- |
| Epic code  | 2–5 capital letters            | `AUTH`, `CP`  |
| User story | `US-<EPIC>-NN`                 | `US-AUTH-01`  |
| Test case  | `TC-<EPIC>-NNN` (never reused) | `TC-AUTH-002` |

Status lifecycle: `planned` → `automated`; or `blocked` (needs a ticket), `manual-only` (reason stated), `wont` (decided not to
test). A case is **covered** only when it is `automated`, its spec exists and passes.

## 4. Working with the catalog

1. **Plan:** add the story and its `+`/`-` rows as `planned` (use the `test-case-planner` agent).
2. **Automate:** write the spec following the AGENTS.md recipes; put the TC ID in the PR description. Spec titles stay
   behaviour sentences.
3. **Close:** set the row to `automated`, tick `Done`, link the spec path.
4. **Verify:** `npm run catalog` (structure, duplicate IDs, spec files exist) and `npm run catalog:report` (coverage table).

Relation to tags: `P0` → `Tag.smoke`, `P1` → `Tag.regression` (AGENTS.md §5.9).

## 5. Agents

Agent roles and models for E2E work are defined at the repository level: see
[`../../.claude/rules/agents-and-models.md`](../../.claude/rules/agents-and-models.md). Whatever agent writes or runs a
spec, the rules come from [../AGENTS.md](../AGENTS.md) and [`../../.claude/rules/e2e-automation.md`](../../.claude/rules/e2e-automation.md).
