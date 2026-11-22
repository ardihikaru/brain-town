import { test, expect } from '@fixtures';
import { expectJson, expectStatus } from '@api/core/assertions';
import { IntegrationListSchema, TOKEN_PATTERN } from '@api/rest/admin/admin.schemas';
import { AcceptedSchema } from '@api/rest/ingest/ingest.schemas';
import { env } from '@config/env';
import { buildGaosTask } from '@data/factories/gaos.factory';
import { cellsLeakingContent, containmentViolations, cellsOverflowing, overlappingNeighbours } from '@utils/geometry';
import { Tag } from '@utils/tags';

test.describe('backoffice · integrations', () => {
  test(
    'creating a GAOS integration shows its ingest URL and a one-time token that works (TC-BO-010)',
    {
      tag: [Tag.smoke],
    },
    async ({ backoffice, page, adminApi, ingestApi, integration, cleanup }) => {
      const existing = await integration('gaos');
      await expectStatus(await ingestApi.send(existing.ingestPath, buildGaosTask(), { token: existing.token }), 202);
      await backoffice.integrations.goto();

      await backoffice.integrations.add('gaos');

      await expect(page).toHaveURL(/#setup-gaos-[0-9a-f]{6}$/);
      await backoffice.setup.expectLoaded();
      const id = backoffice.setup.integrationId();
      cleanup.add(() => adminApi.deleteIntegration(id));
      await expect(backoffice.setup.ingestUrl).toHaveValue(
        `${env.BRAIN_TOWN_URL.replace(/\/+$/, '')}/ingest/gaos/${id}`,
      );
      await expect(backoffice.setup.token).toHaveValue(TOKEN_PATTERN);
      const token = await backoffice.setup.token.inputValue();

      await test.step('the API lists it and the token from the page is accepted', async () => {
        const list = await expectJson(await adminApi.listIntegrations(), IntegrationListSchema);
        expect(list.find((i) => i.id === id)).toMatchObject({ kind: 'gaos', tokenHint: token.slice(-4) });
        await expectJson(await ingestApi.send(`/ingest/gaos/${id}`, buildGaosTask(), { token }), AcceptedSchema, 202);
      });
    },
  );

  const widths = [
    { width: 1280, id: 'TC-BO-011' },
    { width: 820, id: 'TC-BO-012' },
    { width: 390, id: 'TC-BO-013' },
  ];
  for (const { width, id } of widths) {
    test(
      `the event map text stays inside its cells at ${width}px (${id})`,
      { tag: [Tag.regression] },
      async ({ backoffice, page, integration }) => {
        const site = await integration('site');
        await page.setViewportSize({ width, height: 900 });

        await backoffice.setup.open(site.id);

        await expect(backoffice.setup.eventMapTable).toBeVisible();
        await expect(backoffice.setup.eventMapTable).toContainText('site.visit');
        await expect(backoffice.setup.eventMapTable).toContainText('page and country only');
        const cells = await backoffice.setup.measureEventMapCells();
        expect(cells.length).toBeGreaterThan(2);
        const layout = await backoffice.setup.measureEventMapLayout();
        expect(containmentViolations(layout, cells), 'table or cells outside the event map region').toEqual([]);
        expect(cellsOverflowing(cells), 'cells with horizontal overflow').toEqual([]);
        expect(cellsLeakingContent(cells), 'cells whose content leaves the cell').toEqual([]);
        expect(overlappingNeighbours(cells), 'neighbouring cells with overlapping content').toEqual([]);
      },
    );
  }
});
