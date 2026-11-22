import { test, expect } from '@fixtures';
import { expectJson } from '@api/core/assertions';
import { AdminEventSchema, IntegrationSchema } from '@api/rest/admin/admin.schemas';
import {
  integrationEvents,
  publishNote,
  setupSite,
  SITE_AVAILABLE,
  SITE_SKIP_REASON,
} from '@api/stream/integrations/mfardiansyah-id/site.setup';
import { buildNote } from '@data/factories/note.factory';
import { Tag } from '@utils/tags';

test.describe('mfardiansyah.id · push and pull together', () => {
  test.skip(!SITE_AVAILABLE, SITE_SKIP_REASON);

  test(
    'a note the site pushed and Brain Town pulled from the real feed is one event (TC-INTG-020)',
    { tag: [Tag.smoke] },
    async ({ apiContextFor, adminApi, sse, cleanup }) => {
      const { pull, ids, pullFeedUrl } = await setupSite({ apiContextFor, cleanup });
      const stream = await sse.connect('admin');
      // The pull integration is owned by the stack and shared by concurrent runs of this test, so its feedUrl is set
      // (idempotent) and deliberately never cleared afterwards.
      await expectJson(await adminApi.updateIntegration(ids.pull, { feedUrl: pullFeedUrl }), IntegrationSchema);
      const pushedAtOnce = buildNote();
      const goesLiveLater = buildNote({ liveInSeconds: 3 });

      await publishNote(pull, pushedAtOnce, cleanup);
      await publishNote(pull, goesLiveLater, cleanup);

      // A scheduled note is not pushed on save, so the puller (every 2 s in the e2e stack) is the first to see it. The
      // wait is above the 10 s default on purpose: 3 s until it is live, plus a pull interval, plus the https fetch.
      // By then a pull has also run with the first note in the feed.
      await stream.waitForJson(
        AdminEventSchema,
        (e) => e.integration === ids.pull && e.id === `post-${goesLiveLater.slug}`,
        20_000,
      );

      // The site's minute scan later pushes the scheduled note too and gets 409, which v0.54.4 counts as delivered:
      // that is not observable from Brain Town or the site api (manual-only). In a rare run the scan pushes before
      // the pull; either order leaves exactly one event, so these assertions hold.
      const events = await integrationEvents(adminApi, ids.pull, { type: 'article.published' });
      expect(events.filter((e) => e.id === `post-${pushedAtOnce.slug}`)).toHaveLength(1);
      expect(events.filter((e) => e.id === `post-${goesLiveLater.slug}`)).toHaveLength(1);
    },
  );
});
