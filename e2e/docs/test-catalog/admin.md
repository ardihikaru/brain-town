# Admin API (admin)

**Goal:** The single admin manages integrations, tokens, visibility and settings through a cookie-session JSON API.

## User stories

- **US-ADM-01** — As the admin I want to sign in and out so that only I can change the back-office.
- **US-ADM-02** — As the admin I want to create, change and delete integrations so that each platform gets its own URL and token.
- **US-ADM-03** — As the admin I want to rotate a token so that a leaked secret stops working at once.
- **US-ADM-04** — As the admin I want to hide products and orgs under an alias so that private work stays private in the town.
- **US-ADM-05** — As the admin I want an event log and settings so that I can see every delivery and control retention.

## Test cases

One row per test case. `Done` is ☑ exactly when Status is `automated`. Scenario = Given / When / Then in one line.

| Done | TC ID      | Story     | Scenario (Given / When / Then)                                                                                  | +/- | Level | Pri | Status      | Spec                                        |
| ---- | ---------- | --------- | --------------------------------------------------------------------------------------------------------------- | --- | ----- | --- | ----------- | ------------------------------------------- |
| ☑    | TC-ADM-001 | US-ADM-01 | Given the admin account, when it signs in, then the session reports its email and mode                          | +   | API   | P0  | automated   | `tests/api/rest/admin/auth.spec.ts`         |
| ☑    | TC-ADM-002 | US-ADM-01 | Given a wrong password, when signing in, then 401 and no session cookie                                         | -   | API   | P1  | automated   | `tests/api/rest/admin/auth.spec.ts`         |
| ☑    | TC-ADM-003 | US-ADM-01 | Given no session, when any admin endpoint is called, then 401                                                   | -   | API   | P1  | automated   | `tests/api/rest/admin/auth.spec.ts`         |
| ☑    | TC-ADM-004 | US-ADM-01 | Given a session, when signing out, then the session is refused (401)                                            | +   | API   | P1  | automated   | `tests/api/rest/admin/auth.spec.ts`         |
| ☑    | TC-ADM-005 | US-ADM-01 | Given a session, when a mutation is sent as text/plain, then 415                                                | -   | API   | P1  | automated   | `tests/api/rest/admin/auth.spec.ts`         |
| ☑    | TC-ADM-006 | US-ADM-01 | Given a session, when the JSON body is malformed, then 400                                                      | -   | API   | P2  | automated   | `tests/api/rest/admin/auth.spec.ts`         |
| ☐    | TC-ADM-007 | US-ADM-01 | Given 10 failed sign-ins within a minute, when signing in again, then 429 with Retry-After 60                   | -   | API   | P2  | manual-only |                                             |
| ☑    | TC-ADM-010 | US-ADM-02 | Given a session, when an integration is created, then 201 with a one-time token and the list never shows it     | +   | API   | P0  | automated   | `tests/api/rest/admin/integrations.spec.ts` |
| ☑    | TC-ADM-011 | US-ADM-02 | Given an unknown kind, an empty name or a name over 80 characters, when creating, then 422                      | -   | API   | P1  | automated   | `tests/api/rest/admin/integrations.spec.ts` |
| ☑    | TC-ADM-012 | US-ADM-02 | Given an integration, when it is renamed and given an org, then 200 with the new values                         | +   | API   | P1  | automated   | `tests/api/rest/admin/integrations.spec.ts` |
| ☑    | TC-ADM-013 | US-ADM-02 | Given a site integration, when feedUrl is not https, then 422; https is stored and empty clears it              | -   | API   | P1  | automated   | `tests/api/rest/admin/integrations.spec.ts` |
| ☑    | TC-ADM-014 | US-ADM-02 | Given an integration, when it is deleted, then 204, a second delete is 404 and its token gets 401               | +   | API   | P1  | automated   | `tests/api/rest/admin/integrations.spec.ts` |
| ☑    | TC-ADM-015 | US-ADM-02 | Given an unknown id, when it is changed, deleted or rotated, then 404                                           | -   | API   | P2  | automated   | `tests/api/rest/admin/integrations.spec.ts` |
| ☑    | TC-ADM-016 | US-ADM-02 | Given 2 accepted and 1 rejected delivery today, when listing, then today=2 and errors=1                         | +   | API   | P2  | automated   | `tests/api/rest/admin/integrations.spec.ts` |
| ☑    | TC-ADM-020 | US-ADM-03 | Given an integration, when its token is rotated, then the old token gets 401 and the new one 202                | +   | API   | P0  | automated   | `tests/api/rest/admin/token-rotate.spec.ts` |
| ☑    | TC-ADM-030 | US-ADM-04 | Given a GAOS event for a new product, when listing products, then it is public with source GAOS                 | +   | API   | P0  | automated   | `tests/api/rest/admin/visibility.spec.ts`   |
| ☑    | TC-ADM-031 | US-ADM-04 | Given a sender that reports a product hidden, when it first appears, then it is hidden under "Product X"        | +   | API   | P1  | automated   | `tests/api/rest/admin/visibility.spec.ts`   |
| ☑    | TC-ADM-032 | US-ADM-04 | Given a product, when it is hidden with an alias and made public again, then the alias resets to its key        | +   | API   | P1  | automated   | `tests/api/rest/admin/visibility.spec.ts`   |
| ☑    | TC-ADM-033 | US-ADM-04 | Given a bad visibility or an unknown product or org, when saving, then 422 or 404                               | -   | API   | P2  | automated   | `tests/api/rest/admin/visibility.spec.ts`   |
| ☑    | TC-ADM-034 | US-ADM-04 | Given an org from a QA event, when it is hidden with an alias, then products lists the alias                    | +   | API   | P1  | automated   | `tests/api/rest/admin/visibility.spec.ts`   |
| ☑    | TC-ADM-040 | US-ADM-05 | Given an accepted delivery, when reading the event log, then it shows the raw payload and the public view       | +   | API   | P0  | automated   | `tests/api/rest/admin/events.spec.ts`       |
| ☑    | TC-ADM-041 | US-ADM-05 | Given accepted and rejected deliveries, when filtering by delivery, type and text, then only matches are listed | +   | API   | P1  | automated   | `tests/api/rest/admin/events.spec.ts`       |
| ☑    | TC-ADM-050 | US-ADM-05 | Given a session, when settings are read and changed, then the saved values come back                            | +   | API   | P1  | automated   | `tests/api/rest/admin/settings.spec.ts`     |
| ☑    | TC-ADM-051 | US-ADM-05 | Given retentionDays 0, 1, 3650 or 3651, when saved, then it is stored within 1 to 3650                          | -   | API   | P2  | automated   | `tests/api/rest/admin/settings.spec.ts`     |
| ☑    | TC-ADM-052 | US-ADM-05 | Given an integration, when reading stats, then the counts are consistent                                        | +   | API   | P2  | automated   | `tests/api/rest/admin/settings.spec.ts`     |

TC-ADM-007 is `manual-only`: the failure cap is global for the whole API, so tripping it would break every other sign-in for a minute during a parallel run.
