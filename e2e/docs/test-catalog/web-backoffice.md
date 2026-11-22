# Back-office (web)

**Goal:** The admin signs in, connects platforms and watches deliveries live in the back-office page.

## User stories

- **US-BO-01** — As the admin I want to sign in through the page so that I reach the live back-office.
- **US-BO-02** — As the admin I want to add an integration in the page so that I can copy its URL and one-time token.
- **US-BO-03** — As the admin I want the event log to update live so that I see deliveries as they arrive.

## Test cases

One row per test case. `Done` is ☑ exactly when Status is `automated`. Scenario = Given / When / Then in one line.

| Done | TC ID     | Story    | Scenario (Given / When / Then)                                                                                      | +/- | Level | Pri | Status    | Spec                                        |
| ---- | --------- | -------- | ------------------------------------------------------------------------------------------------------------------- | --- | ----- | --- | --------- | ------------------------------------------- |
| ☑    | TC-BO-001 | US-BO-01 | Given a GAOS product exists, when the admin signs in through the form, then the live dashboard opens                | +   | WEB   | P0  | automated | `tests/web/backoffice/login.spec.ts`        |
| ☑    | TC-BO-002 | US-BO-01 | Given a wrong password, when signing in, then an error toast shows and the dashboard stays closed                   | -   | WEB   | P1  | automated | `tests/web/backoffice/login.spec.ts`        |
| ☑    | TC-BO-003 | US-BO-01 | Given any product without an org (every GAOS product), when the back-office loads live data, then it does not crash | +   | WEB   | P0  | automated | `tests/web/backoffice/login.spec.ts`        |
| ☑    | TC-BO-010 | US-BO-02 | Given the integrations page, when GAOS is added, then the setup shows the ingest URL and a token the API accepts    | +   | E2E   | P0  | automated | `tests/web/backoffice/integrations.spec.ts` |
| ☑    | TC-BO-020 | US-BO-03 | Given the event log, when a delivery is accepted, then its row appears live as ok                                   | +   | E2E   | P0  | automated | `tests/web/backoffice/events.spec.ts`       |
| ☑    | TC-BO-021 | US-BO-03 | Given the event log, when a delivery is rejected, then its row appears live as rejected                             | -   | E2E   | P1  | automated | `tests/web/backoffice/events.spec.ts`       |

**Fixed bug (TC-BO-003).** `paintProducts()` in `src/backoffice.src.html` read `o.vis` for the product's org, and `o` was undefined for a product without an org (every GAOS product), so the live back-office failed to load. It is guarded now and TC-BO-001/010/020/021 run without `test.fail()`.
