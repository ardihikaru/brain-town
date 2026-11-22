import { test, expect } from '@fixtures';
import { expectStatus } from '@api/core/assertions';
import { buildGaosProduct, buildGaosTask, buildGaosTaskInfo } from '@data/factories/gaos.factory';
import { buildQaRun, buildQaRunStarted } from '@data/factories/qa.factory';
import { buildSiteVisit } from '@data/factories/site.factory';
import { uniqueId } from '@utils/unique';
import { Tag } from '@utils/tags';

// Arrange via API → act (the platforms send events) → assert in the town's "Live feed".

test.describe('town · live feed', () => {
  test('the town reads the live /events stream (TC-TOWN-001)', { tag: [Tag.smoke] }, async ({ town }) => {
    await town.home.goto();

    await expect(town.home.mode).toHaveText('live SSE');
  });

  test(
    'a GAOS task appears in the feed (TC-TOWN-002)',
    { tag: [Tag.smoke] },
    async ({ town, ingestApi, integration }) => {
      const gaos = await integration('gaos');
      await town.home.goto();
      await expect(town.home.mode).toHaveText('live SSE');
      const task = buildGaosTaskInfo();

      await expectStatus(await ingestApi.send(gaos.ingestPath, buildGaosTask({ task }), { token: gaos.token }), 202);

      await expect(town.home.logLines.filter({ hasText: task.title })).toContainText('issue.opened');
    },
  );

  test(
    'a QA run appears in the feed (TC-TOWN-003)',
    { tag: [Tag.regression] },
    async ({ town, ingestApi, integration }) => {
      const qa = await integration('qa');
      await town.home.goto();
      await expect(town.home.mode).toHaveText('live SSE');
      const run = buildQaRun();

      await expectStatus(await ingestApi.send(qa.ingestPath, buildQaRunStarted(run), { token: qa.token }), 202);

      await expect(town.home.logLines.filter({ hasText: run.spec })).toContainText('qa.run.started');
    },
  );

  test(
    'a site visit appears in the feed (TC-TOWN-004)',
    { tag: [Tag.regression] },
    async ({ town, ingestApi, integration }) => {
      const site = await integration('site');
      await town.home.goto();
      await expect(town.home.mode).toHaveText('live SSE');
      const title = uniqueId('visit');

      await expectStatus(await ingestApi.send(site.ingestPath, buildSiteVisit({ title }), { token: site.token }), 202);

      await expect(town.home.logLines.filter({ hasText: title })).toContainText('site.visit');
    },
  );

  test(
    'a hidden product shows as a private task and its title never reaches the page (TC-TOWN-005)',
    {
      tag: [Tag.regression],
    },
    async ({ town, ingestApi, integration }) => {
      const gaos = await integration('gaos');
      await town.home.goto();
      await expect(town.home.mode).toHaveText('live SSE');
      const task = buildGaosTaskInfo({ id: `T-${Date.now()}` });
      const product = buildGaosProduct({ visibility: 'hidden' });

      await expectStatus(
        await ingestApi.send(gaos.ingestPath, buildGaosTask({ product, task }), { token: gaos.token }),
        202,
      );

      await expect(town.home.logLines.filter({ hasText: `Private task ${task.id}` })).toContainText('issue.opened');
      await expect(town.home.log).not.toContainText(task.title);
    },
  );

  test(
    '?sim=1 plays the built-in simulator instead of the live stream (TC-TOWN-006)',
    {
      tag: [Tag.regression],
    },
    async ({ town }) => {
      await town.home.gotoSimulated();

      await expect(town.home.mode).toHaveText('simulated');
      await expect(town.home.logLines).not.toHaveCount(0);
    },
  );
});
