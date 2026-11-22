import { test, expect } from '@fixtures';
import { expectError, expectJson } from '@api/core/assertions';
import { IntegrationListSchema, RotatedTokenSchema } from '@api/rest/admin/admin.schemas';
import { AcceptedSchema } from '@api/rest/ingest/ingest.schemas';
import { buildGaosTask } from '@data/factories/gaos.factory';
import { Tag } from '@utils/tags';

test.describe('admin · token rotation', () => {
  test(
    'after rotating, the old token is refused (401) and the new one is accepted (202) (TC-ADM-020)',
    {
      tag: [Tag.smoke],
    },
    async ({ adminApi, ingestApi, integration }) => {
      const gaos = await integration('gaos');

      const rotated = await expectJson(await adminApi.rotateToken(gaos.id), RotatedTokenSchema);

      await test.step('old token is refused', async () => {
        await expectError(await ingestApi.send(gaos.ingestPath, buildGaosTask(), { token: gaos.token }), 401);
      });

      await test.step('new token is accepted', async () => {
        await expectJson(
          await ingestApi.send(gaos.ingestPath, buildGaosTask(), { token: rotated.token }),
          AcceptedSchema,
          202,
        );
      });

      await test.step('the list shows the new token hint only', async () => {
        const list = await expectJson(await adminApi.listIntegrations(), IntegrationListSchema);
        expect(rotated.token).not.toBe(gaos.token);
        expect(list.find((i) => i.id === gaos.id)?.tokenHint).toBe(rotated.token.slice(-4));
      });
    },
  );
});
