# Consumers — Brain Town → GAOS

> **Platform:** Brain Town → GAOS.
> **In the town:** nothing. A consumer is a reader, not a participant: it reads the
>   events the town already has and never appears in it.
> **Status:** integration contract (v1). Reader: `backend/internal/consumer`.

## What a consumer is

An **integration** sends events *into* Brain Town: a webhook the town accepts, a feed
the town pulls. A **consumer** reads events *out* of it.

The two are kept apart on purpose:

| | Integration | Consumer |
| --- | --- | --- |
| Direction | in | out |
| Credential | a bearer token, or a webhook signing secret | a bearer token of its own |
| Created by | the platform that sends | the operator, on the platform's behalf |
| Revoking it | stops the sender | stops the reader |
| Its events | reach the town | never reach the town |

A consumer is **scoped**: it says what it wants, and the town sends nothing else. It is
also **revocable** and **rotatable**, and its token is stored as a SHA-256 hash — the
plaintext is shown once, in the back office, and never again.

## Why the consumer path exists

The public stream (`GET /events`) is masked on purpose: a hidden product appears under
its alias, and every title is removed. That is right for a public town and wrong for a
platform that has to act on the event: GAOS needs to know *which* repository and *which*
pull request, by their real names, the moment the event arrives.

So there are two streams:

| | `GET /events` | `GET /consumer/events` |
| --- | --- | --- |
| Audience | anyone | a named machine holder |
| Auth | none | the consumer's bearer token |
| A hidden product | its alias | its **real name** |
| A task title | removed | **present** |
| Scope | everything | only what the consumer asked for |

The consumer stream does **not** carry more source data. The GitHub payload is never
stored, so the consumer receives the same reduced envelope the admin event log shows as
`raw`: the product key, the owner, the task id, the task title and a small `data` map.
**No diff, no PR body, no comment body, no login, no email.** A consumer that needs more
fetches it from the source itself.

## Setup

1. In the back office, open **Consumers**, name the consumer and fill in its scope.
2. Copy the token. It is shown **once**. Hand it to the platform through your own secret
   channel — never in a ticket, never in a chat, never in a repository.
3. The platform reads `GET /consumer/events` with `Authorization: Bearer <token>`.

For GAOS, the scope HISv3 needs is:

```json
{"owners": ["developersismedika"],
 "repos": ["his-v3-ai", "his-backend", "his-frontend", "automation-test-hisv3"],
 "types": ["pr.opened", "pr.merged"],
 "kinds": ["github"]}
```

## Scope

Four dimensions, **ANDed** with each other. An empty dimension matches everything
within it.

| Dimension | Matches | Notes |
| --- | --- | --- |
| `kinds` | the event kind (`github`, `gaos`, `qa`, `site`, `animora`) | |
| `types` | the town event type (`pr.opened`, `pr.merged`, …) | exact |
| `owners` | the event's owner login (`developersismedika`, `ardihikaru`) | case-insensitive |
| `repos` | the event's product key, which for a GitHub event is the **bare repository name** (`his-v3-ai`, not `developersismedika/his-v3-ai`) | case-insensitive |

Each dimension holds at most 64 entries. Owners and repositories are lower-cased and
de-duplicated on the way in; types and kinds are trimmed and de-duplicated. An event with
no owner or no product cannot satisfy an owner or repository filter — a filter that names
something never matches "nothing".

**A scope narrows; it never widens.** A consumer whose scope names a repository that
the town has never seen simply receives nothing for it.

## Request (from the consumer)

```http
GET /consumer/events
Authorization: Bearer bt_c_<40 hex characters>
Accept: text/event-stream
Last-Event-ID: 1975
```

| Header | Meaning |
| --- | --- |
| `Last-Event-ID` | the last sequence number the consumer saw. The town replays everything after it. |
| `?replay=N` | start a fresh subscriber with the newest `N` events, oldest first (1 to 500). Ignored when `Last-Event-ID` is sent. |

## Responses

| Status | When |
| --- | --- |
| `200` | the stream. Server-Sent Events, one frame per event. |
| `401` | the token is missing, unknown, or belongs to a consumer that was deleted or rotated. |

## The frame

The same shape as the public stream — `seq`, `id`, `type`, `source`, `at`, `payload` — with
the payload **unmasked**, plus two fields the store owns:

```
id: 1975
event: pr.opened
data: {"at":"2026-11-24T13:41:31Z","id":"gh-bf746eca-e80c-11f1-8859-ada86aa38a22",
       "kind":"github","type":"pr.opened","seq":1975,
       "orgLogin":"developersismedika","productKey":"his-v3-ai",
       "source":"github",
       "payload":{"at":"2026-11-24T13:41:31Z","id":"gh-bf746eca-e80c-11f1-8859-ada86aa38a22",
                  "org":"developersismedika",
                  "product":{"key":"his-v3-ai","name":"his-v3-ai","visibility":"hidden"},
                  "task":{"id":"4931","kind":"pr","title":"Fix export on long names"},
                  "type":"pr.opened","data":{"pr":4931,"draft":false}}}
```

| Field | Meaning |
| --- | --- |
| `seq` | the town's sequence number. The `Last-Event-ID` cursor. |
| `id` | the town's event id (`gh-<delivery id>`). Use it to de-duplicate. |
| `type` | the town event type. `pr.opened`, `pr.merged`, … |
| `source` | the source kind. `github` for a GitHub webhook. |
| `at` | when the town saw it. UTC. |
| `productKey` | the repository name, from the store. The **real** one, not the alias. |
| `orgLogin` | the owner login, from the store. The **real** one, not the alias. |
| `payload` | the stored envelope, **unmasked**. |

`productKey` and `orgLogin` are the store's own answer, and they are there because a
consumer routes on them: they name the product and its owner whatever shape the sender's
payload used for them. The `payload` is the sender's own envelope, as it was stored: for a
GitHub event `payload.product` is an object (`key`, `name`, `visibility`), for a QA event it
is a plain string.

The `id:` line carries the sequence number and the `event:` line carries the type, so a
consumer that only needs to route can read those two lines and ignore the body.

## What a consumer cannot get

- **The source payload.** The GitHub payload is never stored — no diff, no PR body, no
  comment, no login, no email, no avatar.
- **A rejected delivery.** Only accepted events are sent. A delivery that failed
  verification was never an event.
- **Another consumer's scope.** The stream is filtered before it leaves.

## Admin API

Every route needs a back-office session. No route ever returns a token except the two
that mint one, and those return it once.

| Route | Method | Behaviour |
| --- | --- | --- |
| `GET /api/admin/consumers` | GET | list: id, name, scope, token hint, created, last seen. Never the token, never the hash. |
| `POST /api/admin/consumers` | POST | create. Answers `201 {"consumer":{…},"token":"bt_c_…"}` — the token is in this answer and nowhere else. `409` when the name is taken, `422` for a bad name. |
| `PATCH /api/admin/consumers/{id}` | PATCH | rename and replace the scope. `404` unknown, `409` name taken, `422` bad name. |
| `POST /api/admin/consumers/{id}/token` | POST | rotate. Answers `{"token":"bt_c_…"}` once; the old token stops working at once. |
| `DELETE /api/admin/consumers/{id}` | DELETE | remove it. Its token stops working at once. |

## Privacy

- A consumer token is stored as a SHA-256 hash, like an integration token.
- The token is shown once and never written to a log line, a page or an event.
- The scope is the operator's declaration of what a platform needs. A platform that
  wants more asks for more; the town does not hand out "everything" by default.
- A consumer's scope is **not** part of the public stream and **not** part of the town.
  The back office shows it; the town does not.

## Done checklist

- [ ] A consumer is created and its token copied once.
- [ ] The consumer receives only the events inside its scope.
- [ ] A consumer of a hidden repository sees the repository's real name and the PR title.
- [ ] The public `/events` stream is unchanged by any of this.
- [ ] A rotated token stops working and the new one works.
- [ ] A deleted consumer's token is refused with `401`.
- [ ] The token never appears in a log line, an event or the town.

## As built

Pending the first production run. Record here when the GAOS consumer is registered, its
scope, and the first live `pr.opened` it received.
