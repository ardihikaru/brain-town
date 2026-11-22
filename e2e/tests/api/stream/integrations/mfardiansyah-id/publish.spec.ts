import { test, expect } from '@fixtures';
import { expectJson } from '@api/core/assertions';
import { ArticleRawSchema, SitePostSchema } from '@api/stream/integrations/mfardiansyah-id/site.schemas';
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

// The "push" integration has no feedUrl, so every event on it is a push from the site's publish hook.

test.describe('mfardiansyah.id · publish push', () => {
  test.skip(!SITE_AVAILABLE, SITE_SKIP_REASON);

  test(
    'publishing an English note sends one article.published with the feed id (TC-INTG-010)',
    { tag: [Tag.smoke] },
    async ({ apiContextFor, sse, cleanup }) => {
      const { push, ids } = await setupSite({ apiContextFor, cleanup });
      const stream = await sse.connect('admin');
      const note = buildNote();

      await publishNote(push, note, cleanup);

      const event = await awaitPush(stream, note, ids.push);
      expect(event).toMatchObject({ type: 'article.published', delivery: 'ok' });
      const raw = ArticleRawSchema.parse(event.raw);
      expect(raw.data.title).toBe(note.title);
      expect(raw.data.url.endsWith(`/blog/${note.slug}`)).toBe(true);
    },
  );

  test(
    'saving a published note again does not send it again (TC-INTG-011)',
    { tag: [Tag.regression] },
    async ({ apiContextFor, adminApi, sse, cleanup }) => {
      const { push, ids } = await setupSite({ apiContextFor, cleanup });
      const stream = await sse.connect('admin');
      const note = buildNote();
      const marker = buildNote();
      await publishNote(push, note, cleanup);
      await awaitPush(stream, note, ids.push);

      const saved = await expectJson(await push.saveNote({ ...note, title: `${note.title} (edited)` }), SitePostSchema);
      await expectJson(
        await push.patchNote(note.slug, { version: saved.version, title: `${note.title} (again)` }),
        SitePostSchema,
      );
      await publishNote(push, marker, cleanup);

      // The hub delivers in order: with the marker's push here, a push caused by either re-save would be too.
      await awaitPush(stream, marker, ids.push);
      const pushed = await integrationEvents(adminApi, ids.push, { type: 'article.published' });
      expect(pushed.filter((e) => e.id === `post-${note.slug}`)).toHaveLength(1);
    },
  );
});
