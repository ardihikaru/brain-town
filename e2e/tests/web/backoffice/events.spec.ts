import { test, expect } from '@fixtures';
import { expectStatus } from '@api/core/assertions';
import { buildGaosTask, buildGaosTaskInfo } from '@data/factories/gaos.factory';
import { omit } from '@data/factories/mutate';
import { KnownBug } from '@utils/known-bugs';
import { uniqueId } from '@utils/unique';
import { Tag } from '@utils/tags';

// Arrange via API (an integration that already delivered one GAOS event, as in production), open the event log,
// then new deliveries arrive over /admin/events.

test.describe('backoffice · event log', () => {
  test(
    'an accepted delivery appears in the event log live (TC-BO-020)',
    { tag: [Tag.smoke] },
    async ({ backoffice, ingestApi, integration }) => {
      test.fail(true, KnownBug.backofficeProductWithoutOrg);
      const gaos = await integration('gaos');
      await expectStatus(await ingestApi.send(gaos.ingestPath, buildGaosTask(), { token: gaos.token }), 202);
      await backoffice.events.goto();
      const task = buildGaosTaskInfo();

      await expectStatus(await ingestApi.send(gaos.ingestPath, buildGaosTask({ task }), { token: gaos.token }), 202);

      const row = backoffice.events.row(task.title);
      await expect(row).toContainText('task.created');
      await expect(row).toContainText('ok');
    },
  );

  test(
    'a rejected delivery appears in the event log live, marked rejected (TC-BO-021)',
    {
      tag: [Tag.regression],
    },
    async ({ backoffice, ingestApi, integration }) => {
      test.fail(true, KnownBug.backofficeProductWithoutOrg);
      const name = uniqueId('GAOS');
      const gaos = await integration('gaos', { name });
      await expectStatus(await ingestApi.send(gaos.ingestPath, buildGaosTask(), { token: gaos.token }), 202);
      await backoffice.events.goto();

      await expectStatus(
        await ingestApi.send(gaos.ingestPath, omit(buildGaosTask(), 'product.key'), { token: gaos.token }),
        422,
      );

      await expect(backoffice.events.row(name).filter({ hasText: 'rejected' })).toHaveCount(1);
    },
  );
});
