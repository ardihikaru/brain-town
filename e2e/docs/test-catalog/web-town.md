# Town (web)

**Goal:** The public town reads /events live and shows every accepted event in its "Live feed".

## User stories

- **US-TOWN-01** — As a visitor I want the town to follow the live stream so that I see real work, not a demo.
- **US-TOWN-02** — As the owner I want hidden products to stay private on the page so that titles never leak.
- **US-TOWN-03** — As a visitor I want GitHub issues and comments to show in the live feed under the repo name, with private repos masked.
- **US-TOWN-04** — As a visitor I want the GitHub Valley to show one gate per real GitHub owner, with hidden repos shown only as aliases.
- **US-TOWN-05** — As a visitor I want the QA Lab board grouped by QA tool so that I can tell the company runs from the personal ones.
- **US-TOWN-06** — As a visitor I want the QA Lab board to show the public name of an org, not its key.

## Test cases

One row per test case. `Done` is ☑ exactly when Status is `automated`. Scenario = Given / When / Then in one line.

| Done | TC ID       | Story      | Scenario (Given / When / Then)                                                                                                                                                                                        | +/- | Level | Pri | Status    | Spec                                   |
| ---- | ----------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----- | --- | --------- | -------------------------------------- |
| ☑    | TC-TOWN-001 | US-TOWN-01 | Given the stack, when the town opens, then the pill says "live SSE"                                                                                                                                                   | +   | WEB   | P0  | automated | `tests/web/town/live-feed.spec.ts`     |
| ☑    | TC-TOWN-002 | US-TOWN-01 | Given the open town, when a GAOS task is ingested, then its title appears in the feed                                                                                                                                 | +   | E2E   | P0  | automated | `tests/web/town/live-feed.spec.ts`     |
| ☑    | TC-TOWN-003 | US-TOWN-01 | Given the open town, when a QA run starts, then its spec appears in the feed                                                                                                                                          | +   | E2E   | P1  | automated | `tests/web/town/live-feed.spec.ts`     |
| ☑    | TC-TOWN-004 | US-TOWN-01 | Given the open town, when a site visit is ingested, then it appears in the feed                                                                                                                                       | +   | E2E   | P1  | automated | `tests/web/town/live-feed.spec.ts`     |
| ☑    | TC-TOWN-005 | US-TOWN-02 | Given a hidden product, when its task is ingested, then the feed shows "Private task" and never the title                                                                                                             | -   | E2E   | P0  | automated | `tests/web/town/live-feed.spec.ts`     |
| ☑    | TC-TOWN-006 | US-TOWN-01 | Given ?sim=1, when the town opens, then the simulator plays and the pill says "simulated"                                                                                                                             | +   | WEB   | P2  | automated | `tests/web/town/live-feed.spec.ts`     |
| ☑    | TC-TOWN-010 | US-TOWN-03 | Given the open town, when an issue is opened in a repo, then the feed shows issue.opened with the repo name and issue number                                                                                          | +   | E2E   | P0  | automated | `tests/web/town/github-feed.spec.ts`   |
| ☑    | TC-TOWN-011 | US-TOWN-03 | Given a private repo, when an issue is opened, then the feed shows "Private issue n" and never the title or repo name                                                                                                 | -   | E2E   | P0  | automated | `tests/web/town/github-feed.spec.ts`   |
| ☑    | TC-TOWN-012 | US-TOWN-03 | Given the open town, when five comments hit one issue, then one feed line shows the summed count                                                                                                                      | +   | E2E   | P1  | automated | `tests/web/town/github-feed.spec.ts`   |
| ☑    | TC-TOWN-020 | US-TOWN-04 | Given an owner that exists before load, when the town opens, then the valley is live and the owner has its type and repo as a hall                                                                                    | +   | E2E   | P0  | automated | `tests/web/town/owner-gates.spec.ts`   |
| ☑    | TC-TOWN-021 | US-TOWN-04 | Given the open town, when a brand-new owner's first event arrives, then it is added and its type is learned without a reload                                                                                          | +   | E2E   | P0  | automated | `tests/web/town/owner-gates.spec.ts`   |
| ☑    | TC-TOWN-022 | US-TOWN-04 | Given a private repo, when the town loads, then its hall is the alias and the real name is not in the town state                                                                                                      | -   | E2E   | P0  | automated | `tests/web/town/owner-gates.spec.ts`   |
| ☑    | TC-TOWN-030 | US-TOWN-05 | Given two named QA integrations with one run each, when the QA Lab board opens, then it shows a group per tool with its run card and tool chip                                                                        | +   | E2E   | P0  | automated | `tests/web/town/qa-tool-board.spec.ts` |
| ☑    | TC-TOWN-031 | US-TOWN-05 | Given no QA run has reached the town, when the QA Lab board opens, then it shows the "No test runs yet." empty state; when the first run arrives, then the empty state is replaced by the tool group and its run card | +   | E2E   | P1  | automated | `tests/web/town/qa-tool-board.spec.ts` |
| ☑    | TC-TOWN-040 | US-TOWN-06 | Given a QA org with an alias, when a run reaches the QA Lab board, then its label shows the alias and not the key                                                                                                     | +   | E2E   | P0  | automated | `tests/web/town/qa-org-alias.spec.ts`  |
