import { test, expect } from '@fixtures';
import { expectStatus } from '@api/core/assertions';
import {
  publishNote,
  setupSite,
  SITE_AVAILABLE,
  SITE_SKIP_REASON,
} from '@api/stream/integrations/mfardiansyah-id/site.setup';
import { buildNote } from '@data/factories/note.factory';
import { Tag } from '@utils/tags';

// site-api-offline points BRAIN_TOWN_URL at a closed port (connection refused), like a stopped town. The site must
// stay fully usable: every call below has to finish within the normal API timeout.

test.describe('mfardiansyah.id · Brain Town unreachable', () => {
  test.skip(!SITE_AVAILABLE, SITE_SKIP_REASON);

  test('publishing a note still succeeds (TC-INTG-040)', { tag: [Tag.smoke] }, async ({ apiContextFor, cleanup }) => {
    const { offline } = await setupSite({ apiContextFor, cleanup });
    const note = buildNote();

    const saved = await publishNote(offline, note, cleanup);

    expect(saved.slug).toBe(note.slug);
  });

  test(
    'the home page and a note still load (TC-INTG-041)',
    { tag: [Tag.regression] },
    async ({ apiContextFor, cleanup }) => {
      const { offline } = await setupSite({ apiContextFor, cleanup });
      const note = buildNote();
      await publishNote(offline, note, cleanup);

      await expectStatus(await offline.home(), 200);
      await expectStatus(await offline.blog(note.slug), 200);
    },
  );
});
