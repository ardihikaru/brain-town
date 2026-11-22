import { test, expect } from '@fixtures';
import { expectJson } from '@api/core/assertions';
import { SiteFeedSchema } from '@api/stream/integrations/mfardiansyah-id/site.schemas';
import {
  awaitPush,
  integrationEvents,
  publishNote,
  setupSite,
  SITE_AVAILABLE,
  SITE_SKIP_REASON,
} from '@api/stream/integrations/mfardiansyah-id/site.setup';
import { buildNote } from '@data/factories/note.factory';
import { Tag } from '@utils/tags';

// The site's real api (v0.54.x, built from the site repo by the e2e stack) is the system under test; Brain Town only
// receives. See docs/integrations/mfardiansyah-id.md and the skill mfardiansyah-id-integration.

test.describe('mfardiansyah.id · feed.json', () => {
  test.skip(!SITE_AVAILABLE, SITE_SKIP_REASON);

  test(
    'the feed is a JSON Feed 1.1 of at most 20 English notes, newest first (TC-INTG-001)',
    { tag: [Tag.smoke] },
    async ({ apiContextFor, cleanup }) => {
      const { push } = await setupSite({ apiContextFor, cleanup });

      const response = await push.feed();
      const feed = await expectJson(response, SiteFeedSchema);

      expect(response.headers()['content-type']).toContain('application/feed+json');
      expect(response.headers()['cache-control']).toContain('max-age=300');
      expect(feed.items.length).toBeLessThanOrEqual(20);
      for (const item of feed.items) {
        expect(item.id).toBe(`post-${new URL(item.url).pathname.split('/').pop()}`);
        expect(item.tags[0]).toBe('article');
      }
      const times = feed.items.map((item) => Date.parse(item.date_published));
      expect(times).toEqual([...times].sort((a, b) => b - a));
    },
  );

  test(
    'a published note appears in the feed with id post-<slug> and its blog url (TC-INTG-002)',
    { tag: [Tag.regression] },
    async ({ apiContextFor, cleanup }) => {
      // The feed is the same code on every instance; the offline one keeps this note out of the push integration's
      // ingest budget (INGEST_RATE / INGEST_BURST are low in the e2e stack and shared by all parallel workers).
      const { offline } = await setupSite({ apiContextFor, cleanup });
      const note = buildNote();
      await publishNote(offline, note, cleanup);

      const feed = await expectJson(await offline.feed(), SiteFeedSchema);

      const item = feed.items.find((i) => i.id === `post-${note.slug}`);
      expect(item).toMatchObject({ title: note.title, _kind: 'article' });
      expect(item?.url.endsWith(`/blog/${note.slug}`)).toBe(true);
    },
  );

  test(
    'an Indonesian note is neither in the feed nor pushed (TC-INTG-003)',
    { tag: [Tag.regression] },
    async ({ apiContextFor, adminApi, sse, cleanup }) => {
      const { push, ids } = await setupSite({ apiContextFor, cleanup });
      const stream = await sse.connect('admin');
      const indonesian = buildNote({ locale: 'id' });
      const marker = buildNote();

      await publishNote(push, indonesian, cleanup);
      await publishNote(push, marker, cleanup);

      // Pushes arrive in the order the site sends them: once the marker is here, an Indonesian push would be too.
      await awaitPush(stream, marker, ids.push);
      const feed = await expectJson(await push.feed(), SiteFeedSchema);
      const pushed = await integrationEvents(adminApi, ids.push, { type: 'article.published' });
      expect(feed.items.map((i) => i.id)).not.toContain(`post-${indonesian.slug}`);
      expect(pushed.map((e) => e.id)).not.toContain(`post-${indonesian.slug}`);
    },
  );
});
