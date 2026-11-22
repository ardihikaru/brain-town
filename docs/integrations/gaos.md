# GAOS → Brain Town

> **Platform:** [GAOS](https://github.com/ardihikaru/gaos) — a graph-native agent operating system (open source).
> **In the town:** each GAOS product is a hall; each task is a person moving through the queue, the design gate and an agent.
> **Status:** integration contract (v1). The receiving backend is on the roadmap; see the [README](../../README.md#roadmap).

---

## Task: send GAOS events to Brain Town

Repo: `ardihikaru/gaos` · Receiver: `https://town.mfardiansyah.id`

Brain Town is a public, animated town that shows work as it happens. Each GAOS product becomes a hall in the town and each task becomes a person who queues, waits at the design gate, gets worked on by an agent, and leaves when done. GAOS only has to tell Brain Town when something changes. Brain Town never calls GAOS back.

This file was written without access to the GAOS source. Where a name below differs from the real GAOS model (column names, task kinds, agent ids), keep the GAOS name and map it in the `data` fields.

## What to build

An outbound event emitter: when a product or task changes state, GAOS sends one HTTP POST to Brain Town.

### Configuration

| Setting | Example | Notes |
| --- | --- | --- |
| `BRAIN_TOWN_ENABLED` | `true` | Off by default. When off, nothing is sent. |
| `BRAIN_TOWN_URL` | `https://town.mfardiansyah.id/ingest/gaos/<integration-id>` | Copied from the Brain Town back-office, Integrations, GAOS. |
| `BRAIN_TOWN_TOKEN` | `bt_live_…` | Sent as `Authorization: Bearer <token>`. Keep it out of logs. |

### When to send

| GAOS moment | `type` |
| --- | --- |
| Product created, renamed, or its visibility changed | `product.upserted` |
| Task created | `task.created` |
| Task moved to another kanban column | `task.moved` |
| Design gate review requested for a task | `gate.requested` |
| Design gate decided | `gate.decided` |
| An agent claims a task | `task.claimed` |
| A QA result is attached to a task | `task.qa` |
| Task finished | `task.done` |
| Task failed or was cancelled | `task.failed` |

### Request

```http
POST /ingest/gaos/<integration-id>
Authorization: Bearer <token>
Content-Type: application/json
Idempotency-Key: <event id>
```

```json
{
  "id": "01JD3X9T2M8Q4W6Z7K5B",
  "type": "task.moved",
  "at": "2026-11-21T09:14:03Z",
  "product": { "key": "article2video", "name": "Article to Video", "visibility": "public" },
  "task": { "id": "T-204", "title": "Add caption timing", "kind": "feature", "column": "in_progress" },
  "data": { "from": "ready", "to": "in_progress", "agent": "agent-7" }
}
```

Field rules:

- `id`: unique per event and stable across retries. A ULID or UUID is fine.
- `at`: UTC, RFC 3339.
- `product.key`: stable slug. Brain Town keys its hall on it.
- `product.visibility`: `public` or `hidden`. For `hidden`, Brain Town shows an alias and never shows task titles. Still send the real values; hiding happens on the Brain Town side.
- `task` is omitted for `product.upserted`.
- `data` per type: `task.moved` has `from`, `to`; `gate.decided` has `decision` (`approved` or `rejected`); `task.claimed` has `agent`; `task.qa` has `passed`, `failed`, `total`; `task.failed` has `reason`.

### Delivery rules

- Send after the state change is committed, from a background worker. A slow or failing Brain Town must never slow down or fail a GAOS task.
- Timeout 3 seconds. Retry up to 3 times with backoff (1 s, 5 s, 30 s) on network errors, `429` and `5xx`. Do not retry other `4xx`.
- Keep order per task: do not send `task.done` before `task.claimed` for the same task.
- Log one line per failed delivery with the event id and status code.

## Responses from Brain Town

| Status | Meaning |
| --- | --- |
| `202` | Accepted. |
| `401` | Token missing or wrong. |
| `409` | This `Idempotency-Key` was already accepted. Treat as success. |
| `422` | Body failed validation. The response names the field. |
| `429` | Slow down and retry. |

## Done when

- [ ] With `BRAIN_TOWN_ENABLED=false`, no request leaves GAOS.
- [ ] Creating a task, moving it across every column, passing the design gate and finishing it produces the matching events, in order.
- [ ] Stopping Brain Town for a minute does not block or fail any GAOS operation.
- [ ] A retried event carries the same `id`.
- [ ] The token never appears in logs or error messages.
- [ ] A short section in the GAOS README explains the three settings.

## Try it by hand

```bash
curl -X POST "$BRAIN_TOWN_URL" \
  -H "Authorization: Bearer $BRAIN_TOWN_TOKEN" -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-001" \
  -d '{"id":"test-001","type":"task.created","at":"2026-11-21T09:00:00Z","product":{"key":"demo","name":"Demo","visibility":"public"},"task":{"id":"T-1","title":"Hello town","kind":"feature","column":"backlog"}}'
```

A person should appear at the Demo hall in the town, and the delivery shows in the back-office event log.
