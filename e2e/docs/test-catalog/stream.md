# Event streams (stream)

**Goal:** The town and the back-office receive events live over SSE: public events masked, every delivery for the admin.

## User stories

- **US-STR-01** — As a town visitor I want accepted events pushed live so that the town moves as work happens.
- **US-STR-02** — As the owner I want hidden products and orgs masked on the public stream so that private names never leak.
- **US-STR-03** — As the admin I want rejected deliveries on my stream only so that I can debug senders without exposing them.
- **US-STR-04** — As a town visitor I want missed events replayed after a reconnect so that a network blip loses nothing.
- **US-STR-05** — As a town visitor I want GitHub activity pushed live, grouped and masked for private repos, so that the town moves with the org without leaking private work.
- **US-STR-06** — As a town visitor I want a public masked snapshot of owners and repos so that the town draws one gate per GitHub owner without leaking hidden names.

## Test cases

One row per test case. `Done` is ☑ exactly when Status is `automated`. Scenario = Given / When / Then in one line.

| Done | TC ID      | Story     | Scenario (Given / When / Then)                                                                                                               | +/- | Level | Pri | Status    | Spec                                                   |
| ---- | ---------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --- | ----- | --- | --------- | ------------------------------------------------------ |
| ☑    | TC-STR-001 | US-STR-01 | Given a subscriber, when a GAOS event is accepted, then it is pushed as a named event with id = seq and the public envelope                  | +   | API   | P0  | automated | `tests/api/stream/events/public-stream.spec.ts`        |
| ☑    | TC-STR-002 | US-STR-01 | Given a subscriber, when a QA run, an article or a visit is accepted, then it is pushed with its source                                      | +   | API   | P1  | automated | `tests/api/stream/events/public-stream.spec.ts`        |
| ☑    | TC-STR-003 | US-STR-01 | Given two subscribers, when an event is accepted, then both receive the same payload                                                         | +   | API   | P1  | automated | `tests/api/stream/events/public-stream.spec.ts`        |
| ☑    | TC-STR-010 | US-STR-02 | Given a product hidden in the back-office, when its task event is pushed, then only the alias shows and the title is removed                 | +   | API   | P0  | automated | `tests/api/stream/events/masking.spec.ts`              |
| ☑    | TC-STR-011 | US-STR-02 | Given a sender that reports a product hidden, when its first event is pushed, then it is already masked                                      | +   | API   | P1  | automated | `tests/api/stream/events/masking.spec.ts`              |
| ☑    | TC-STR-012 | US-STR-02 | Given a hidden org, when a QA step is pushed, then org and product show the org alias and step/spec are removed                              | +   | API   | P1  | automated | `tests/api/stream/events/masking.spec.ts`              |
| ☑    | TC-STR-013 | US-STR-02 | Given an admin subscriber, when a hidden product's event arrives, then raw is unmasked and public is masked                                  | +   | API   | P1  | automated | `tests/api/stream/events/masking.spec.ts`              |
| ☑    | TC-STR-020 | US-STR-03 | Given both streams, when a delivery is rejected, then it shows on /admin/events and never on /events                                         | -   | API   | P0  | automated | `tests/api/stream/events/rejected.spec.ts`             |
| ☑    | TC-STR-021 | US-STR-03 | Given no or a forged session cookie, when opening /admin/events, then 401                                                                    | -   | API   | P1  | automated | `tests/api/stream/events/rejected.spec.ts`             |
| ☑    | TC-STR-030 | US-STR-04 | Given a subscriber that disconnected, when it reconnects with Last-Event-ID, then the missed events are replayed in order                    | +   | API   | P0  | automated | `tests/api/stream/events/replay.spec.ts`               |
| ☐    | TC-STR-031 | US-STR-01 | Given an idle stream, when 15 s pass, then a heartbeat comment arrives                                                                       | +   | API   | P3  | wont      |                                                        |
| ☑    | TC-STR-040 | US-STR-05 | Given a subscriber, when an issue is opened, then it is pushed as issue.opened with the town envelope                                        | +   | API   | P0  | automated | `tests/api/stream/github/github-stream.spec.ts`        |
| ☑    | TC-STR-041 | US-STR-05 | Given a subscriber, when five comments hit one issue, then one issue.commented rollup with count 5 is pushed and no comment text             | +   | API   | P0  | automated | `tests/api/stream/github/github-stream.spec.ts`        |
| ☑    | TC-STR-042 | US-STR-05 | Given a private repo, when an issue is opened, then the product shows an alias and the task has no title                                     | +   | API   | P0  | automated | `tests/api/stream/github/github-stream.spec.ts`        |
| ☑    | TC-STR-043 | US-STR-05 | Given an admin subscriber, when a ping is delivered, then it is pushed with the ticked events                                                | +   | API   | P1  | automated | `tests/api/stream/github/github-stream.spec.ts`        |
| ☑    | TC-STR-044 | US-STR-05 | Given a private repo registered hidden by its ping, when an issue is opened, then /events shows the alias and never the repo name or title   | +   | API   | P0  | automated | `tests/api/stream/github/github-owner-masking.spec.ts` |
| ☑    | TC-STR-050 | US-STR-06 | Given a fresh personal owner with a public repo, when GET /api/town without auth, then 200 no-store lists the owner (type user) and the repo | +   | API   | P0  | automated | `tests/api/rest/town/town-snapshot.spec.ts`            |
| ☑    | TC-STR-051 | US-STR-06 | Given an organization owner, when GET /api/town, then its type is organization                                                               | +   | API   | P1  | automated | `tests/api/rest/town/town-snapshot.spec.ts`            |
| ☑    | TC-STR-052 | US-STR-06 | Given a private repo, when GET /api/town, then it is only an alias (hidden, Product n) and the repo name is nowhere in the response          | -   | API   | P0  | automated | `tests/api/rest/town/town-snapshot.spec.ts`            |
| ☑    | TC-STR-053 | US-STR-06 | Given an owner hidden in the back-office, when GET /api/town, then it shows under its alias and neither its key nor its repo names appear    | -   | API   | P0  | automated | `tests/api/rest/town/town-snapshot.spec.ts`            |

TC-STR-031 is `wont`: it needs a 15 s idle wait per run for little value (the heartbeat is a fixed ticker).
