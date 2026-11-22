import { test, expect } from '@fixtures';
import { expectStatus } from '@api/core/assertions';
import { setupSite, SITE_AVAILABLE, SITE_SKIP_REASON } from '@api/stream/integrations/mfardiansyah-id/site.setup';
import { Tag } from '@utils/tags';

test.describe('mfardiansyah.id · office page', () => {
  test.skip(!SITE_AVAILABLE, SITE_SKIP_REASON);

  test(
    'the /office page the town links to loads (TC-INTG-050)',
    { tag: [Tag.regression] },
    async ({ apiContextFor, cleanup }) => {
      const { web } = await setupSite({ apiContextFor, cleanup });

      const response = await web.office();

      await expectStatus(response, 200);
      expect(response.headers()['content-type']).toContain('text/html');
    },
  );
});
