# Feed puller (feed)

**Goal:** Brain Town pulls the site's https JSON Feed and turns new items into article.published events, deduplicated with the push.

## User stories

- **US-FEED-01** — As the site owner I want new feed items to appear in the town so that a missed push hook is not a lost article.

## Test cases

One row per test case. `Done` is ☑ exactly when Status is `automated`. Scenario = Given / When / Then in one line.

| Done | TC ID       | Story      | Scenario (Given / When / Then)                                                                                          | +/- | Level | Pri | Status    | Spec                                        |
| ---- | ----------- | ---------- | ----------------------------------------------------------------------------------------------------------------------- | --- | ----- | --- | --------- | ------------------------------------------- |
| ☑    | TC-FEED-001 | US-FEED-01 | Given a site integration with an https feedUrl, when the puller runs, then each new item is pushed as article.published | +   | API   | P0  | automated | `tests/api/stream/events/feed-pull.spec.ts` |
| ☑    | TC-FEED-002 | US-FEED-01 | Given an item the feed delivered, when the site pushes the same id, then 409                                            | -   | API   | P1  | automated | `tests/api/stream/events/feed-pull.spec.ts` |
| ☑    | TC-FEED-003 | US-FEED-01 | Given items without a title or with a bad date, when pulled, then they are skipped                                      | -   | API   | P2  | automated | `tests/api/stream/events/feed-pull.spec.ts` |
| ☐    | TC-FEED-004 | US-FEED-01 | Given an http:// feedUrl, when saving it, then 422 (covered by TC-ADM-013)                                              | -   | API   | P1  | wont      |                                             |
| ☐    | TC-FEED-005 | US-FEED-01 | Given the real api image, when it pulls a publicly trusted https feed, then the certificate verifies                    | +   | E2E   | P0  | blocked   |                                             |

TC-FEED-005 is `blocked`: the api image is `FROM scratch` without a CA bundle, so pulling a real https feed in production most likely fails with "certificate signed by unknown authority". The e2e stack works around it with `SSL_CERT_FILE` and a throwaway CA, which proves the puller logic but not production trust. Verifying it needs internet access, which this local-only suite does not use.
