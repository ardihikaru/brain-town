# Back-office (web)

**Goal:** The admin signs in, connects platforms and watches deliveries live in the back-office page.

## User stories

- **US-BO-01** — As the admin I want to sign in through the page so that I reach the live back-office.
- **US-BO-02** — As the admin I want to add an integration in the page so that I can copy its URL and one-time token.
- **US-BO-03** — As the admin I want the event log to update live so that I see deliveries as they arrive.
- **US-BO-04** — As the admin I want Copy on the setup page to never copy a masked token so that I never paste a dead credential; when the token is no longer shown I rotate it and copy the new one.
- **US-BO-05** — As the admin I want a GitHub setup page that shows the secret on demand and which events are ticked so that I can wire the org webhook without guessing.

## Test cases

One row per test case. `Done` is ☑ exactly when Status is `automated`. Scenario = Given / When / Then in one line.

| Done | TC ID     | Story    | Scenario (Given / When / Then)                                                                                                                                | +/- | Level | Pri | Status    | Spec                                        |
| ---- | --------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----- | --- | --------- | ------------------------------------------- |
| ☑    | TC-BO-001 | US-BO-01 | Given a GAOS product exists, when the admin signs in through the form, then the live dashboard opens                                                          | +   | WEB   | P0  | automated | `tests/web/backoffice/login.spec.ts`        |
| ☑    | TC-BO-002 | US-BO-01 | Given a wrong password, when signing in, then an error toast shows and the dashboard stays closed                                                             | -   | WEB   | P1  | automated | `tests/web/backoffice/login.spec.ts`        |
| ☑    | TC-BO-003 | US-BO-01 | Given any product without an org (every GAOS product), when the back-office loads live data, then it does not crash                                           | +   | WEB   | P0  | automated | `tests/web/backoffice/login.spec.ts`        |
| ☑    | TC-BO-010 | US-BO-02 | Given the integrations page, when GAOS is added, then the setup shows the ingest URL and a token the API accepts                                              | +   | E2E   | P0  | automated | `tests/web/backoffice/integrations.spec.ts` |
| ☑    | TC-BO-011 | US-BO-04 | Given a GAOS integration just created in the page, when Copy is clicked, then the clipboard holds the real token (no mask) and the API accepts it             | +   | E2E   | P1  | automated | `tests/web/backoffice/secret.spec.ts`       |
| ☑    | TC-BO-012 | US-BO-04 | Given an integration created via the API, when its setup page is opened or reloaded, then it shows the hidden note and Rotate, no masked field                | +   | E2E   | P0  | automated | `tests/web/backoffice/secret.spec.ts`       |
| ☑    | TC-BO-013 | US-BO-04 | Given the hidden state, when Rotate and copy is confirmed inline (Rotate now), then the clipboard and field hold a new working token and the old one gets 401 | +   | E2E   | P0  | automated | `tests/web/backoffice/secret.spec.ts`       |
| ☑    | TC-BO-014 | US-BO-04 | Given the hidden state, when Rotate and copy then Cancel is clicked, then the hidden state returns and the old token still gets 202                           | +   | E2E   | P1  | automated | `tests/web/backoffice/secret.spec.ts`       |
| ☑    | TC-BO-015 | US-BO-02 | Given a site integration's setup page at 1280px wide, when the event map renders, then every cell's text stays inside it and neighbours do not overlap | +   | WEB   | P1  | automated | `tests/web/backoffice/integrations.spec.ts` |
| ☑    | TC-BO-016 | US-BO-02 | Given a site integration's setup page at 820px wide, when the event map renders, then every cell's text stays inside it and neighbours do not overlap  | +   | WEB   | P1  | automated | `tests/web/backoffice/integrations.spec.ts` |
| ☑    | TC-BO-017 | US-BO-02 | Given a site integration's setup page at 390px wide, when the event map renders, then every cell's text stays inside it and neighbours do not overlap  | +   | WEB   | P1  | automated | `tests/web/backoffice/integrations.spec.ts` |
| ☑    | TC-BO-020 | US-BO-03 | Given the event log, when a delivery is accepted, then its row appears live as ok                                                                             | +   | E2E   | P0  | automated | `tests/web/backoffice/events.spec.ts`       |
| ☑    | TC-BO-021 | US-BO-03 | Given the event log, when a delivery is rejected, then its row appears live as rejected                                                                       | -   | E2E   | P1  | automated | `tests/web/backoffice/events.spec.ts`       |
| ☑    | TC-BO-030 | US-BO-05 | Given a GitHub integration, when Show is pressed, then the field goes from empty to the whsec_ secret, no bullet characters, and it signs deliveries          | +   | E2E   | P0  | automated | `tests/web/backoffice/github-setup.spec.ts` |
| ☑    | TC-BO-031 | US-BO-05 | Given a hidden secret, when Copy is pressed, then the clipboard holds the real secret and it signs deliveries                                                 | +   | E2E   | P0  | automated | `tests/web/backoffice/github-setup.spec.ts` |
| ☑    | TC-BO-032 | US-BO-05 | Given the checklist, when a chip is opened, then the details say what GitHub sends, what is kept, what shows in town and how bursts group                     | +   | WEB   | P1  | automated | `tests/web/backoffice/github-setup.spec.ts` |
| ☑    | TC-BO-033 | US-BO-05 | Given no ping yet, then every chip is neutral and no warning shows                                                                                            | +   | WEB   | P2  | automated | `tests/web/backoffice/github-setup.spec.ts` |
| ☑    | TC-BO-034 | US-BO-05 | Given a ping without Pull requests, then the missing-mandatory callout lists it and its chip is missing                                                       | -   | E2E   | P0  | automated | `tests/web/backoffice/github-setup.spec.ts` |
| ☑    | TC-BO-035 | US-BO-05 | Given a complete ping, then chips show subscribed, not needed and not ticked, and no callout                                                                  | +   | E2E   | P1  | automated | `tests/web/backoffice/github-setup.spec.ts` |
| ☑    | TC-BO-036 | US-BO-05 | Given the open setup page, when a ping arrives, then the chips update live                                                                                    | +   | E2E   | P0  | automated | `tests/web/backoffice/github-setup.spec.ts` |

**Fixed bug (TC-BO-003).** `paintProducts()` in `src/backoffice.src.html` read `o.vis` for the product's org, and `o` was undefined for a product without an org (every GAOS product), so the live back-office failed to load. It is guarded now and TC-BO-001/010/020/021 run without `test.fail()`.
