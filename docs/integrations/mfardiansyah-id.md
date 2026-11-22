# mfardiansyah.id → Brain Town

> **Platform:** [mfardiansyah.id](https://mfardiansyah.id) — the author's personal site and blog.
> **In the town:** a pendopo; couriers bring new articles and illustrations, and visitors travel in from their countries.
> **Status:** live. The receiver (`/ingest/site/<id>`, feed puller) runs on `town.mfardiansyah.id`; the site sends visits since v0.54.3 (2026-11-23). Local both-sides check: skill `.claude/skills/mfardiansyah-id-integration/`.

---

## Task: connect mfardiansyah.id to Brain Town

Repo: the mfardiansyah.id site · Receiver: `https://town.mfardiansyah.id`

Brain Town shows the site as a pendopo. When an article or illustration is published, a courier walks to it. The site has to tell Brain Town about new content. Two ways are supported; build both, in this order.

## Part 1: a feed Brain Town can pull

Needs no secret and works even if Part 2 is never built.

- Expose `https://mfardiansyah.id/feed.json` (JSON Feed 1.1) or an RSS/Atom feed listing the latest 20 published items, newest first.
- Each item needs: a stable `id`, `url`, `title`, `date_published`, and a tag or field that says whether it is an `article` or an `illustration`.
- Brain Town checks the feed every 5 minutes and emits one event per new `id`.

## Part 2: a publish hook that pushes

Makes the courier appear within a second of publishing.

### Configuration

| Setting | Example | Notes |
| --- | --- | --- |
| `BRAIN_TOWN_URL` | `https://town.mfardiansyah.id/ingest/site/<integration-id>` | From the Brain Town back-office, Integrations, mfardiansyah.id. |
| `BRAIN_TOWN_TOKEN` | `bt_live_…` | Sent as `Authorization: Bearer <token>`. Keep it in the deploy secrets. |

### When to send

| Moment | `type` |
| --- | --- |
| An article goes live | `article.published` |
| An illustration goes live | `illustration.published` |

Send once per item, after the page is reachable. If the site is statically built, do it as the last deploy step, for items whose `id` was not in the previous build.

```json
{
  "id": "post-shipping-reports-as-images",
  "type": "article.published",
  "at": "2026-11-21T09:14:03Z",
  "data": { "title": "Shipping reports as images", "url": "https://mfardiansyah.id/blog/shipping-reports", "to": "blog" }
}
```

### Rules

- A failed call must not fail the publish or the deploy: 3 second timeout, log and continue.
- Use the same `id` as the feed, so an item seen by both push and pull is counted once.
- Send public content only. Drafts and scheduled items are not sent.

## Part 3: a visit beacon

Brain Town turns each visit into a person who travels into the town, so the site reports page views of the home page and blog articles.

- On each page view of `/` or `/blog/...`, the server (or an edge function) sends one `site.visit` event. Do it server-side, so no token ever reaches the browser.
- Send only two facts: which page, and the visitor's country as a two-letter code taken from the request (for example the CDN's country header). Never send the IP address, user agent, cookies or any identifier of the person.
- `id` is a random value per page view. It must not be derived from the visitor.
- Skip bots and the site owner's own visits where that is easy to detect.
- This is best effort: 2 second timeout, no retries. A lost visit only means one fewer person in the town.

```json
{
  "id": "b7f3c2e1-9a40-4d0e-8f65-2c1d7a9e0b11",
  "type": "site.visit",
  "at": "2026-11-22T00:14:03Z",
  "data": { "page": "blog", "country": "JP", "title": "Shipping reports as images" }
}
```

`page` is `home` or `blog`. `title` is optional and only for blog articles. Brain Town invents everything else for the animation (who the visitor is, how they travel, how long they stay), so nothing more is needed from the site.

## Part 4: the office page

The town's pendopo links to `https://mfardiansyah.id/office`. Make sure that page exists and returns `200`.

## Done when

- [ ] The feed URL returns the latest 20 items with the fields above.
- [ ] Publishing a test article produces exactly one `article.published`, with the same `id` the feed shows.
- [ ] A deploy with Brain Town unreachable still succeeds.
- [ ] Opening the home page and one blog article each produce one `site.visit` with the right `page` and a two-letter `country`.
- [ ] The `site.visit` body contains no IP address and nothing that identifies the person.
- [ ] `/office` loads.

## Try it by hand

```bash
curl -X POST "$BRAIN_TOWN_URL" \
  -H "Authorization: Bearer $BRAIN_TOWN_TOKEN" -H "Content-Type: application/json" \
  -d '{"id":"test-post-1","type":"article.published","at":"2026-11-21T09:00:00Z","data":{"title":"Hello town","url":"https://mfardiansyah.id/blog/hello","to":"blog"}}'
```

A courier should walk to the mfardiansyah.id pendopo in the town.

## Pull fallback

Set the integration's `feedUrl` (PATCH `/api/admin/integrations/{id}`) to the site's https JSON Feed 1.1; Brain Town pulls the latest 20 items every 5 minutes as `article.published` with `id` = item id, so a push with the same id is deduplicated.

## Automated check

The both-sides behaviour (feed contract, publish push, push+pull dedupe, visit beacon and its skips, Brain Town down,
`/office`) is covered by the E2E suite against the real site: `e2e/tests/api/stream/integrations/mfardiansyah-id/`
(`cd e2e && npm run test:local -- tests/api/stream/integrations`).

## As built (mfardiansyah.id v0.54.3, PR #157)
- **Feed:** `https://mfardiansyah.id/feed.json`, the latest 20 live English notes. Item `id` is `post-<slug>`, the same as the push `id`, so the two paths dedupe. `_kind` is always `article`; there are no illustrations on this site.
- **Push:** `article.published` is sent once per note (also for scheduled notes when their time passes) with `data{title,url,to:"blog"}`. Indonesian twins are not announced.
- **Visit beacon:** sent server-side from the home and blog handlers. Country comes from a local GeoIP lookup. Bots, prefetches and admin sessions are skipped; no IP or user agent is sent. A page cached by the browser for 60 s sends nothing on repeat loads. There is no retry and at most 16 in flight.
- **Env** on the site: `BRAIN_TOWN_ENABLED=true`, `BRAIN_TOWN_URL=https://<host>/ingest/site/<integration-id>` (https only) and `BRAIN_TOWN_TOKEN=bt_live_...`. All three are needed; until they are set both push and beacon stay off.
- **v0.54.4:** a visit without a two-letter country is not sent (the receiver requires `country`, 422 otherwise); a push answered `409` (the puller already has the id) counts as delivered.
- **Privacy:** `/privacy` describes the beacon (site PR #158).
- **Not yet seen live:** the publish push; it is proven by the first real EN note.
