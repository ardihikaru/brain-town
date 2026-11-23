# Test catalog

The checklist of **what Brain Town should be tested for** and how much of it is automated. Organized by epic (one file
per epic), traceable from user story to spec. Concepts and rules: [../test-strategy.md](../test-strategy.md).

Not every case is automated — `planned`, `blocked`, `manual-only` and `wont` rows say why. A case counts as covered only
when its status is `automated` and the linked spec exists and passes (a spec marked `test.fail()` for a known app bug
counts as automated: it passes while the bug exists and turns red when the bug is fixed).

## Coverage

<!-- coverage:start -->

| Epic                                                          | Cases |   + |   - | automated | planned | blocked | manual-only | wont | Automated % |
| ------------------------------------------------------------- | ----: | --: | --: | --------: | ------: | ------: | ----------: | ---: | ----------: |
| [Admin API (admin)](admin.md)                                 |    48 |  26 |  22 |        47 |       0 |       0 |           1 |    0 |         98% |
| [Feed puller (feed)](feed.md)                                 |     5 |   2 |   3 |         3 |       0 |       1 |           0 |    1 |         60% |
| [Ingest (ingest)](ingest.md)                                  |    38 |  21 |  17 |        38 |       0 |       0 |           0 |    0 |        100% |
| [mfardiansyah.id integration (integrations)](integrations.md) |    18 |   8 |  10 |        16 |       0 |       0 |           2 |    0 |         89% |
| [Event streams (stream)](stream.md)                           |    24 |  20 |   4 |        23 |       0 |       0 |           0 |    1 |         96% |
| [Back-office (web)](web-backoffice.md)                        |    36 |  28 |   8 |        36 |       0 |       0 |           0 |    0 |        100% |
| [Town (web)](web-town.md)                                     |    15 |  12 |   3 |        15 |       0 |       0 |           0 |    0 |        100% |
| **Total**                                                     |   184 | 117 |  67 |       178 |       0 |       1 |           3 |    2 |         97% |

<!-- coverage:end -->

Refresh with `npm run catalog:report`; validate with `npm run catalog`.

## Legend

| Field  | Values                                                                                                       |
| ------ | ------------------------------------------------------------------------------------------------------------ |
| +/-    | `+` happy path, `-` negative path (invalid input, missing auth, wrong role, not found, business rule)        |
| Level  | `API` REST/SSE, `GQL` GraphQL (unused here), `WEB` single-app UI, `E2E` journey across api, stream and UI    |
| Pri    | `P0` critical path → `@smoke`; `P1` important → `@regression`; `P2` normal; `P3` edge/nice-to-have           |
| Status | `planned`, `automated`, `blocked` (needs a ticket), `manual-only` (reason in the scenario), `wont` (decided) |

## Epics

| Epic                                | Target                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| [Admin API](admin.md)               | `/api/admin/*` (REST, cookie session)                                                |
| [Ingest](ingest.md)                 | `/ingest/{gaos,qa,site}/{id}` (REST, Bearer), `/ingest/github/{id}` (signed webhook) |
| [Event streams](stream.md)          | `/events`, `/admin/events` (SSE)                                                     |
| [Feed puller](feed.md)              | site JSON Feed → `article.published`                                                 |
| [Site integration](integrations.md) | the real mfardiansyah.id site, both sides (feed, push, visits, offline)              |
| [Town](web-town.md)                 | `/` (web)                                                                            |
| [Back-office](web-backoffice.md)    | `/backoffice/` (web)                                                                 |

New epic: copy [_template.md](_template.md), add it to this table, run `npm run catalog:report`.
