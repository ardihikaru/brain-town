import { test, expect } from '@fixtures';
import { expectError, expectJson, expectStatus } from '@api/core/assertions';
import { CreatedIntegrationSchema, IntegrationListSchema, IntegrationSchema } from '@api/rest/admin/admin.schemas';
import type { CreateIntegrationInput } from '@api/rest/admin/admin.client';
import { buildGaosTask } from '@data/factories/gaos.factory';
import { omit } from '@data/factories/mutate';
import { uniqueId } from '@utils/unique';
import { Tag } from '@utils/tags';

test.describe('admin · integrations', () => {
  test(
    'creating an integration returns its token once and lists it without the secret (TC-ADM-010)',
    {
      tag: [Tag.smoke],
    },
    async ({ adminApi, cleanup }) => {
      const name = uniqueId('gaos');

      const created = await expectJson(
        await adminApi.createIntegration({ kind: 'gaos', name, org: 'e2e-org' }),
        CreatedIntegrationSchema,
        201,
      );
      cleanup.add(() => adminApi.deleteIntegration(created.integration.id));
      const list = await expectJson(await adminApi.listIntegrations(), IntegrationListSchema);

      expect(created.integration).toMatchObject({ kind: 'gaos', name, org: 'e2e-org' });
      expect(created.ingestPath).toBe(`/ingest/gaos/${created.integration.id}`);
      expect(created.integration.tokenHint).toBe(created.token.slice(-4));
      const row = list.find((i) => i.id === created.integration.id);
      expect(row).toMatchObject({ name, today: 0, errors: 0, tokenHint: created.token.slice(-4) });
      expect(JSON.stringify(list)).not.toContain(created.token);
    },
  );

  const invalidCreates: { title: string; input: CreateIntegrationInput }[] = [
    { title: 'an unknown kind', input: { kind: 'jira', name: 'x' } },
    { title: 'an empty name', input: { kind: 'gaos', name: '   ' } },
    { title: 'a name over 80 characters', input: { kind: 'gaos', name: 'n'.repeat(81) } },
  ];
  for (const { title, input } of invalidCreates) {
    test(
      `creating an integration with ${title} is refused (422) (TC-ADM-011)`,
      { tag: [Tag.regression] },
      async ({ adminApi }) => {
        await expectError(await adminApi.createIntegration(input), 422);
      },
    );
  }

  test(
    'an integration can be renamed and given an org (TC-ADM-012)',
    { tag: [Tag.regression] },
    async ({ adminApi, integration }) => {
      const created = await integration('qa');
      const name = uniqueId('renamed');

      const updated = await expectJson(
        await adminApi.updateIntegration(created.id, { name, org: 'e2e-org-2' }),
        IntegrationSchema,
      );

      expect(updated).toMatchObject({ id: created.id, name, org: 'e2e-org-2' });
    },
  );

  const badFeedUrls = ['http://feed-fixture:8443/feed.json', 'ftp://example.test/feed.json', 'https://', 'not a url'];
  for (const feedUrl of badFeedUrls) {
    test(
      `feedUrl "${feedUrl}" is refused, only https is allowed (422) (TC-ADM-013)`,
      {
        tag: [Tag.regression],
      },
      async ({ adminApi, integration }) => {
        const site = await integration('site');

        await expectError(await adminApi.updateIntegration(site.id, { feedUrl }), 422);
      },
    );
  }

  test(
    'an https feedUrl is stored and an empty one disables pulling (TC-ADM-013)',
    {
      tag: [Tag.regression],
    },
    async ({ adminApi, integration }) => {
      const site = await integration('site');
      const feedUrl = 'https://feed-fixture:8443/does-not-exist.json';

      const set = await expectJson(await adminApi.updateIntegration(site.id, { feedUrl }), IntegrationSchema);
      const cleared = await expectJson(await adminApi.updateIntegration(site.id, { feedUrl: '' }), IntegrationSchema);

      expect(set.feedUrl).toBe(feedUrl);
      expect(cleared.feedUrl).toBeUndefined();
    },
  );

  test(
    'a deleted integration is gone and its token stops working (TC-ADM-014)',
    { tag: [Tag.regression] },
    async ({ adminApi, ingestApi }) => {
      const created = await expectJson(
        await adminApi.createIntegration({ kind: 'gaos', name: uniqueId('gaos') }),
        CreatedIntegrationSchema,
        201,
      );

      await expectStatus(await adminApi.deleteIntegration(created.integration.id), 204);

      const list = await expectJson(await adminApi.listIntegrations(), IntegrationListSchema);
      expect(list.map((i) => i.id)).not.toContain(created.integration.id);
      await expectError(await adminApi.deleteIntegration(created.integration.id), 404);
      await expectError(await ingestApi.send(created.ingestPath, buildGaosTask(), { token: created.token }), 401);
    },
  );

  test('changing an unknown integration answers 404 (TC-ADM-015)', { tag: [Tag.regression] }, async ({ adminApi }) => {
    const unknown = 'gaos-ffffff';

    await expectError(await adminApi.updateIntegration(unknown, { name: 'x' }), 404);
    await expectError(await adminApi.deleteIntegration(unknown), 404);
    await expectError(await adminApi.rotateToken(unknown), 404);
  });

  test(
    'the list counts accepted and rejected deliveries of today (TC-ADM-016)',
    { tag: [Tag.regression] },
    async ({ adminApi, ingestApi, integration }) => {
      const gaos = await integration('gaos');
      await expectStatus(await ingestApi.send(gaos.ingestPath, buildGaosTask(), { token: gaos.token }), 202);
      await expectStatus(await ingestApi.send(gaos.ingestPath, buildGaosTask(), { token: gaos.token }), 202);
      await expectStatus(
        await ingestApi.send(gaos.ingestPath, omit(buildGaosTask(), 'id'), { token: gaos.token }),
        422,
      );

      const list = await expectJson(await adminApi.listIntegrations(), IntegrationListSchema);

      expect(list.find((i) => i.id === gaos.id)).toMatchObject({ today: 2, errors: 1 });
    },
  );
});
