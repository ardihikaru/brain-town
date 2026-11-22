# Town (web)

**Goal:** The public town reads /events live and shows every accepted event in its "Live feed".

## User stories

- **US-TOWN-01** — As a visitor I want the town to follow the live stream so that I see real work, not a demo.
- **US-TOWN-02** — As the owner I want hidden products to stay private on the page so that titles never leak.

## Test cases

One row per test case. `Done` is ☑ exactly when Status is `automated`. Scenario = Given / When / Then in one line.

| Done | TC ID       | Story      | Scenario (Given / When / Then)                                                                            | +/- | Level | Pri | Status    | Spec                               |
| ---- | ----------- | ---------- | --------------------------------------------------------------------------------------------------------- | --- | ----- | --- | --------- | ---------------------------------- |
| ☑    | TC-TOWN-001 | US-TOWN-01 | Given the stack, when the town opens, then the pill says "live SSE"                                       | +   | WEB   | P0  | automated | `tests/web/town/live-feed.spec.ts` |
| ☑    | TC-TOWN-002 | US-TOWN-01 | Given the open town, when a GAOS task is ingested, then its title appears in the feed                     | +   | E2E   | P0  | automated | `tests/web/town/live-feed.spec.ts` |
| ☑    | TC-TOWN-003 | US-TOWN-01 | Given the open town, when a QA run starts, then its spec appears in the feed                              | +   | E2E   | P1  | automated | `tests/web/town/live-feed.spec.ts` |
| ☑    | TC-TOWN-004 | US-TOWN-01 | Given the open town, when a site visit is ingested, then it appears in the feed                           | +   | E2E   | P1  | automated | `tests/web/town/live-feed.spec.ts` |
| ☑    | TC-TOWN-005 | US-TOWN-02 | Given a hidden product, when its task is ingested, then the feed shows "Private task" and never the title | -   | E2E   | P0  | automated | `tests/web/town/live-feed.spec.ts` |
| ☑    | TC-TOWN-006 | US-TOWN-01 | Given ?sim=1, when the town opens, then the simulator plays and the pill says "simulated"                 | +   | WEB   | P2  | automated | `tests/web/town/live-feed.spec.ts` |
