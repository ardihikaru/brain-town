import { test, expect } from '@fixtures';
import { expectJson, expectStatus } from '@api/core/assertions';
import { IntegrationListSchema, TOKEN_PATTERN } from '@api/rest/admin/admin.schemas';
import { AcceptedSchema } from '@api/rest/ingest/ingest.schemas';
import { env } from '@config/env';
import { buildGaosTask } from '@data/factories/gaos.factory';
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
});
