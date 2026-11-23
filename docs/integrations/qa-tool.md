# QA Tool → Brain Town

> **Platform:** QA Tool — the author's Playwright end-to-end testing tool. *Not open source yet; it will be released later.*
> **In the town:** each test run is a QA bot walking through its steps in the QA Lab.
> **Status:** integration contract (v1). The receiving backend is on the roadmap; see the [README](../../README.md#roadmap).

---

## Task: report Playwright runs to Brain Town

Repo: the QA tool (Playwright end-to-end tests) · Receiver: `https://town.mfardiansyah.id`

Brain Town shows each product's automated test run as a QA bot walking through its steps in the QA Lab. The QA tool has to post each run as it happens. Brain Town never calls the QA tool back.

## What to build

A custom Playwright reporter, `brain-town-reporter.ts`, added next to the existing reporters.

### One integration per QA tool instance

There are two QA tool deployments (the company one and a personal one). Each gets its **own** Brain Town QA
integration, created in the back-office with a custom name, for example `QA · Sismedika` and `QA · Personal`. Names
are unique among QA integrations (case-insensitive); a duplicate is `409`. The town's QA Lab groups runs by that
name: every public QA event carries it as `tool`.

If `org` is omitted from an event, Brain Town fills it from the integration's org (set in the back-office). An `org`
the sender provides is kept. The QA executor always sends an `org` (see `BRAIN_TOWN_ORG` below), so this fill only
applies to senders that omit it.

### Configuration

Setup is not a CI secret. It is the executor env file `~/.config/qa-automation/playwright-executor.env` on the host
that runs the QA executor; restart the executor after editing it. The reporter reads these variables.

| Variable | Example | Notes |
| --- | --- | --- |
| `BRAIN_TOWN_URL` | `https://town.mfardiansyah.id/ingest/qa/<integration-id>` | From the back-office, Integrations, the QA integration. |
| `BRAIN_TOWN_TOKEN` | `bt_live_…` | Sent as `Authorization: Bearer <token>`. |
| `BRAIN_TOWN_ORG` | `sismedika` | Set it to the real org. The executor defaults to `example-org` when unset and always sends the org, so Brain Town's fill-from-integration never applies to this sender. |
| `BRAIN_TOWN_PRODUCTS` | `1=sipreport,2=hisv3` | `<id>=<key>` pairs, `<id>` being the id of `automation-<id>.env`. |
| `BRAIN_TOWN_PRODUCT` | `sipreport` | Single product key, used when `BRAIN_TOWN_PRODUCTS` has no entry for the id. Without both, the key is `product-<id>`. |

If `BRAIN_TOWN_URL` is not set, the reporter does nothing.

`EXECUTOR_BRAIN_TOWN_REPORTER=0` turns the reporter off for every instance.

Further instances are selected by `EXECUTOR_EXTRA_TOKENS`. It is a comma list of the executor's **own** bearer
tokens (each at least 32 characters), the ones QA tool instances use to call the executor. It is not the Brain Town
token. `EXECUTOR_TOKEN` and bare tokens form the default instance. An entry may be written `name:token`, where `name`
matches `[a-z][a-z0-9_-]{0,31}` (lower-cased). The executor picks the instance from the bearer token of the request
that queued the run.

For a named instance, the variables are `BRAIN_TOWN_URL__<NAME>`, `BRAIN_TOWN_TOKEN__<NAME>`,
`BRAIN_TOWN_ORG__<NAME>`, `BRAIN_TOWN_PRODUCT__<NAME>` and `BRAIN_TOWN_PRODUCTS__<NAME>`, with `<NAME>` the name
upper-cased and `-` replaced by `_`. A named instance without its own `BRAIN_TOWN_URL__<NAME>` has the reporter off:
there is no fallback to the default instance's URL or token.

```sh
# ~/.config/qa-automation/playwright-executor.env  (placeholders only)
BRAIN_TOWN_URL=https://town.mfardiansyah.id/ingest/qa/qa-xxxxxx
BRAIN_TOWN_TOKEN=bt_live_xxxxxxxxxxxxxxxx
BRAIN_TOWN_ORG=sismedika
BRAIN_TOWN_PRODUCTS=1=sipreport,2=hisv3

# a second instance, selected by the executor token of its qa-tool
EXECUTOR_EXTRA_TOKENS=personal:<executor token, 32+ chars>
BRAIN_TOWN_URL__PERSONAL=https://town.mfardiansyah.id/ingest/qa/qa-yyyyyy
BRAIN_TOWN_TOKEN__PERSONAL=bt_live_yyyyyyyyyyyyyyyy
BRAIN_TOWN_ORG__PERSONAL=<real org>
BRAIN_TOWN_PRODUCTS__PERSONAL=1=notes
```

### Events

One run is one spec file executed once.

| Reporter hook | `type` | `data` |
| --- | --- | --- |
| `onTestBegin` (first test of a spec) | `qa.run.started` | `spec`, `steps` (titles, when known) |
| `onStepEnd` for steps with category `test.step` | `qa.step` | `index`, `step`, `status` (`passed` or `failed`), `duration_ms` |
| `onTestEnd` (last test of a spec) | `qa.run.finished` | `spec`, `passed`, `failed`, `total`, `duration_ms` |

```json
{
  "id": "run-1763715243-3",
  "type": "qa.step",
  "at": "2026-11-21T09:14:03Z",
  "product": "sipreport",
  "org": "sismedika",
  "run": "run-1763715243",
  "data": { "index": 2, "step": "Sign in", "status": "passed", "duration_ms": 840 }
}
```

Only steps written as `await test.step('Sign in', async () => { … })` are reported, so the names shown in the town are the names in the spec. Wrap the main actions of each spec in `test.step`.

### Rules

- Never fail or slow a test run because Brain Town is unreachable: 2 second timeout, swallow errors, no retries inside the test process.
- `onEnd` must wait for the last request so the final event is not lost when the process exits.
- Do not send page content, screenshots, credentials or error stacks. A failed step sends its title and status only.
- `run` is the same value for every event of one spec execution.

## Done when

- [ ] Running one spec locally produces `qa.run.started`, one `qa.step` per `test.step`, then `qa.run.finished`.
- [ ] A failing step produces `status: "failed"` and `failed: 1` in the final event.
- [ ] With `BRAIN_TOWN_URL` unset, no request is made and test output is unchanged.
- [ ] With Brain Town unreachable, the run takes no more than 2 seconds longer in total.
- [ ] The settings are in the executor env file (not CI secrets) and the executor was restarted.

## Try it by hand

```bash
curl -X POST "$BRAIN_TOWN_URL" \
  -H "Authorization: Bearer $BRAIN_TOWN_TOKEN" -H "Content-Type: application/json" \
  -d '{"id":"t-1","type":"qa.run.started","at":"2026-11-21T09:00:00Z","product":"sipreport","run":"t","data":{"spec":"login.spec.ts","steps":["Open page","Sign in","Check result"]}}'
```

The QA bot for that product should start walking in the QA Lab.

## As built (qa-automation-tools PR #75)
- The reporter is `playwright-executor/reporters/brain-town-reporter.cjs`, configured from env (the executor selects reporters with `--reporter=`, which cannot carry options).
- **Product keys:** the executor only knows the `automation-<id>.env` id, so `BRAIN_TOWN_PRODUCTS` maps `<id>=<key>` (for example `1=sipreport,2=hisv3`). `BRAIN_TOWN_PRODUCT` is the fallback key; without it the key is `product-<id>`. Create the same keys as products in the back-office.
- `org` comes from `BRAIN_TOWN_ORG` (the executor falls back to `example-org`, so always set it).
- Envelope: `{id: "<run>-<seq>", type, at, product, org, run, data}`. `run` is the same for every event of one execution; `id` is unique per event.
- Steps appear only for specs that wrap actions in `await test.step('name', ...)`. Otherwise only `qa.run.started` and `qa.run.finished` arrive. Only top-level steps are reported.
- No error text, stack, page content or screenshots are sent. A failed step sends its title and `failed`.
- No retries. After the first failed request the rest of that run's events are dropped.
