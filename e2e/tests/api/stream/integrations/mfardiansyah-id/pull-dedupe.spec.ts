import { test, expect } from '@fixtures';
import { expectJson } from '@api/core/assertions';
import { AdminEventSchema, CreatedIntegrationSchema, IntegrationSchema } from '@api/rest/admin/admin.schemas';
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
import { uniqueId } from '@utils/unique';

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
      // The witness: a second site integration that only pulls. The site never pushes to it (its api token belongs to
      // ids.pull), so every event on it came from the puller. PullAll pulls every site integration with a feedUrl each
      // tick, so a tick that delivers a note to the witness also pulled it for ids.pull.
      const witness = await expectJson(
        await adminApi.createIntegration({ kind: 'site', name: uniqueId('site-witness') }),
        CreatedIntegrationSchema,
        201,
      );
      const witnessId = witness.integration.id;
      cleanup.add(() => adminApi.deleteIntegration(witnessId));
      await expectJson(await adminApi.updateIntegration(witnessId, { feedUrl: pullFeedUrl }), IntegrationSchema);
      const pushedAtOnce = buildNote();
      const goesLiveLater = buildNote({ liveInSeconds: 3 });
      const idOf = (note: { slug: string }): string => `post-${note.slug}`;

      // The first note is pushed on save (milliseconds) while the puller runs every 2 s, so normally the push lands
      // first; awaitPush only proves the note reached ids.pull.
      await publishNote(pull, pushedAtOnce, cleanup);
      await awaitPush(stream, pushedAtOnce, ids.pull);

      // A scheduled note is not pushed on save. The wait is above the 10 s default on purpose: 3 s until it is live,
      // plus a pull interval (2 s in the e2e stack), plus the https fetch. Both notes must reach the witness: that
      // proves the pull path delivers the scheduled note, and that a pull tick ran after the first note was pushed.
      await publishNote(pull, goesLiveLater, cleanup);
      for (const note of [goesLiveLater, pushedAtOnce]) {
        await stream.waitForJson(AdminEventSchema, (e) => e.integration === witnessId && e.id === idOf(note), 20_000);
      }

      // Pushed and pulled events share id and shape, so exactly one event per note on ids.pull means push and pull were
      // deduplicated (both reached ids.pull: the push on save, the pull proven by the witness tick), whichever came
      // first. The other direction (pull first, then the site's minute scan push gets
      // 409, counted as delivered) is not observable from outside: manual-only, TC-INTG-021.
      const events = await integrationEvents(adminApi, ids.pull, { type: 'article.published' });
      const witnessEvents = await integrationEvents(adminApi, witnessId, { type: 'article.published' });
      for (const note of [pushedAtOnce, goesLiveLater]) {
        expect(events.filter((e) => e.id === idOf(note))).toHaveLength(1);
        expect(witnessEvents.filter((e) => e.id === idOf(note))).toHaveLength(1);
      }
    },
  );
});
