# GitHub → Brain Town

> **Platform:** GitHub organisation webhooks.
> **In the town:** each GitHub org is a gate in GitHub Valley and each repo is a hall behind it. Issues are people,
> pull requests are scrolls, CI runs are carts, discussions are guests at the Tea House and stars are lanterns.
> **Status:** integration contract (v1). Receiver: `backend/internal/github`.

Unlike GAOS, the QA tool and the site, GitHub needs **no code in another repo**. GitHub sends its own webhook
payloads; Brain Town verifies them, keeps only what the town needs, and turns them into town events.

## Setup

1. In the back-office, Integrations, add **GitHub**. Optionally set the org on the integration.
2. In GitHub, open the organisation, then Settings, Webhooks, Add webhook.
3. **Payload URL:** `https://<brain-town>/ingest/github/<integration-id>` (shown on the setup page).
4. **Content type:** `application/json`. Form-encoded deliveries are refused (`415`).
5. **Secret:** the `whsec_…` value from the setup page. It is stored encrypted, so the setup page can show and copy it
   again at any time. Rotating it makes the old one stop working right away.
6. Choose **Let me select individual events** and tick the events below. Save. GitHub sends a `ping`; the setup page
   ticks its last step and shows which events are subscribed.

### Event tiers (GitHub's checkbox names)

| Tier | Events | Why |
| --- | --- | --- |
| **Mandatory** | Issues, Pull requests | Without them the org gate stays empty. A warning shows on the setup page when either is missing from the ping. |
| **Recommended** | Workflow runs + Workflow jobs, **or** Check runs | CI carts on the halls. When Workflow runs or Workflow jobs are subscribed, check runs from the `github-actions` app are skipped so CI is not counted twice. |
| **Optional** | Issue comments, Pull request reviews, Pull request review comments, Sub issues, Pushes, Labels, Branch or tag creation, Branch or tag deletion, Discussions, Discussion comments, Stars | Extra life in the valley. All of them are grouped (see Rollups). |

`ping` is automatic. Any event not listed here is answered `202 {"status":"ignored"}` and not stored.

## Request (from GitHub)

```http
POST /ingest/github/<integration-id>
Content-Type: application/json
X-GitHub-Event: issues
X-GitHub-Delivery: 72d3162e-cc78-11e3-81ab-4c9367dc0958
X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the raw body with the whsec secret>
```

## Responses

| Status | When |
| --- | --- |
| `202` | `{"status":"accepted"}` stored (or queued in a rollup), `{"status":"ignored"}` for an event or action the town does not use, `{"status":"skipped"}` for a bot sender or a duplicate CI source. GitHub always gets its answer at once; nothing waits for the rollup. |
| `401` | Unknown integration, not a GitHub integration, missing or wrong `X-Hub-Signature-256` (checked in constant time on the raw body, before anything is parsed). Logged as rejected for a known integration. |
| `409` | `X-GitHub-Delivery` already accepted for this integration (GitHub "Redeliver"). Grouped deliveries are claimed too. |
| `413` | Body over 2 MB. |
| `415` | Content type is not `application/json`. |
| `422` | Missing `X-GitHub-Event` or `X-GitHub-Delivery`, body not JSON, or org mismatch (see below). `field` names the problem. |
| `429` | Over the per-integration rate (`INGEST_RATE`/`INGEST_BURST`, same bucket logic as the other sources). `Retry-After: 1`. |
| `503` | `BRAIN_TOWN_SECRET_KEY` is not configured, so the secret cannot be decrypted. |

**Org check.** The delivery's org is `organization.login`, else `repository.owner.login`. If the integration has an org
set, they must be equal (case-insensitive), otherwise `422 {"field":"organization"}`. If the integration has no org yet,
the first accepted delivery sets it.

## Storage and privacy

The GitHub payload is **never stored**. Brain Town stores a small envelope instead (below), so comment bodies, commit
messages, review text, user logins, emails and avatars never reach the database or any stream.

- **Private repos** (`repository.private: true`) are reported as `hidden`, so a new product is created hidden and its
  org/product names are replaced by aliases on `/events`. After that, the back-office visibility wins (same rule as GAOS).
- For hidden events, `visibility.View` removes `task.title` and the `data` fields `title`, `url`, `ref`, `label`,
  `branch`, `workflow`, `check` (plus the existing sensitive fields). Colours and counts stay.
- **Bots.** Deliveries whose `sender.type` is `Bot` or whose login ends in `[bot]` are skipped (`202 skipped`, not
  stored) for: issue comments, pull request review comments, pull request reviews, discussion comments. Bot issues
  and pull requests (for example Dependabot) are kept.

### Stored and public envelope

```json
{
  "id": "gh-72d3162e-cc78-11e3-81ab-4c9367dc0958",
  "type": "issue.opened",
  "at": "2026-11-23T09:14:03Z",
  "org": "sismedika",
  "product": { "key": "sipreport", "name": "sipreport", "visibility": "public" },
  "task": { "id": "48", "title": "Export fails on long names", "kind": "issue" },
  "data": { }
}
```

- `id`: `gh-<delivery id>` for single events, `gh-roll-<first delivery id>` for rollups.
- `at`: the time Brain Town received the (first) delivery, UTC.
- `product.key` and `product.name`: the repo name (not `owner/repo`), so the town can match its hall by repo.
- `task`: present when the event is about one issue, pull request or discussion. `id` is the number as a string;
  `kind` is `issue`, `pr` or `discussion`. Absent for repo-level events (push, refs, labels, stars).

## Event mapping

`G` = grouped into a rollup (see below). `data` lists the fields on the town event.

| GitHub event (actions) | Town `type` | `data` | `G` | Town object (GitHub Valley) |
| --- | --- | --- | --- | --- |
| `ping` | `ping` | `events` (hook.events) | | none; saves `events` on the integration and ticks the setup page |
| `issues` opened, reopened | `issue.opened` | `labels` (colours only, `["#d73a4a"]`) | | person queueing at the org gate |
| `issues` assigned | `issue.assigned` | | | the person walks into the product hall to be worked on |
| `issues` edited, when the body's task-list count changed | `task.done` | `done`, `total` (counted from `- [x]` / `- [ ]`) | | progress pips over the person |
| `issues` closed | `issue.closed` | `reason` (`completed`, `not_planned`) | | the person leaves |
| `issues` labeled | `issue.labeled` | `color` (`#rrggbb`), `label` (name) | G | coloured ribbon on the person |
| `sub_issues` (sub_issue_added/removed, parent_issue_added/removed) | `issue.subissues` | `count`, `done` (from the parent's `sub_issues_summary`) | G | **family**: the parent issue walks with up to 4 kids, `+n` badge beyond |
| `pull_request` opened, reopened, ready_for_review | `pr.opened` | `pr` (number), `issue` (first `Fixes/Closes/Resolves #n` in the body, else omitted), `draft` | | scroll carried into the hall |
| `pull_request` closed, merged | `pr.merged` | `pr`, `issue` | | scroll stamped, issue person heads out |
| `pull_request` closed, not merged | `pr.closed` | `pr`, `issue` | | scroll dropped |
| `pull_request_review` submitted | `pr.reviewed` | `pr`, `approved`, `changes`, `commented` (counts in the window) | G | inspector at the hall door stamps ✓ / ✗ |
| `issue_comment` created, `pull_request_review_comment` created | `issue.commented` | `count`; `task.kind` is `pr` when the comment is on a pull request | G | speech bubble `💬 4`, small kids following the issue person (or over the hall for a PR) |
| `check_run` completed (only with a pull request) | `pr.checks` | `pr`, `check` (name), `status` (`passed`, `failed`) | | check pad on the PR in the hall |
| `workflow_run` requested, in_progress, completed; `workflow_job` queued, in_progress, completed | `ci.run` | `run` (run id), `status` (`queued`, `running`, `passed`, `failed`), `jobs` `{total, done, failed}`, `pr` (when known), `workflow` (name) | G per run | cart on the hall's track pulling one box per job |
| `push` (with at least one commit) | `repo.pushed` | `commits`, `branch` | G per repo + branch | courier with N parcels walking into the hall |
| `create` | `ref.created` | `refType` (`branch`, `tag`), `count`, `ref` (last name) | G per repo + refType | lantern (branch) or banner (tag) hung on the hall eaves |
| `delete` | `ref.deleted` | `refType`, `count`, `ref` | G per repo + refType | lantern or banner taken down |
| `label` created, edited, deleted | `repo.labels` | `count` | G per repo | sign painter at the hall |
| `discussion` created | `discussion.opened` | | | guest arrives at the **Tea House** |
| `discussion` answered | `discussion.answered` | | | guest bows and leaves |
| `discussion_comment` created | `discussion.commented` | `count` | G | bubbles and kids at the guest's table |
| `star` created | `repo.starred` | `count`, `total` (`repository.stargazers_count`) | G per repo | star lanterns rise above the org gate; total on the org card |

Other actions of these events (for example `issues` deleted, `star` deleted) are `202 ignored`.

**Check runs vs workflows.** A `check_run` whose `check_suite.app.slug` is `github-actions` is skipped when the
integration's saved `events` include `workflow_run`, `workflow_job` or `*`. A `check_run` without a pull request is
ignored.

## Rollups

Grouped events are merged on the server so a burst becomes one town event:

- **Key:** integration + repo + subject + town type. The subject is the issue/PR/discussion number, the run id, the
  branch, the ref type, or nothing (repo-level).
- **Window:** 15 s from the first delivery for that key. When the window closes, one event is stored and published with
  the summed `count` (or the latest state, for `ci.run` and `issue.subissues`).
- **Dedupe:** every delivery id is claimed when it arrives (`409` on a repeat), grouped or not.
- **Bounds:** at most 1,000 open rollups; when full, the oldest is flushed at once. Open rollups are flushed on shutdown.
- `LastEventAt` of the integration is updated when a delivery is claimed, so the back-office health stays live.

## Secret

- Format `whsec_` + 32 random bytes, base64url. Generated on create and on rotate of a GitHub integration.
- Stored as AES-256-GCM ciphertext (`secretEnc`) with the key from `BRAIN_TOWN_SECRET_KEY` (32 bytes, base64).
  The plaintext is never persisted or logged. Bearer tokens of the other sources stay hash-only.
- `GET /api/admin/integrations/{id}/secret` (admin session, `Cache-Control: no-store`) returns `{"secret":"whsec_…"}`
  for a GitHub integration, `404` for any other kind, `503` when the key is not configured.
- `BRAIN_TOWN_SECRET_KEY` is required in `BRAIN_TOWN_MODE=prod`. In other modes, when it is empty, the service generates
  a random key per process and logs a warning: GitHub secrets created then stop working after a restart.

## Admin API additions

Integration objects gain `events` (the list from the last `ping`, empty until then). The setup page uses it to show
✓ subscribed / ⚠ missing per event.

## Done checklist

- [ ] A `ping` is accepted and the setup page shows the subscribed events.
- [ ] A wrong signature is refused with `401` and logged as rejected.
- [ ] Opening, assigning and closing an issue walks a person through GitHub Valley.
- [ ] Ten comments in a few seconds become one `issue.commented` with `count: 10`.
- [ ] A private repo appears under an alias with no titles.
