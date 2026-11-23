import { test, expect } from '@fixtures';
import { expectError, expectJson } from '@api/core/assertions';
import { CreatedIntegrationSchema, IntegrationListSchema, IntegrationSchema } from '@api/rest/admin/admin.schemas';
import { setupGithub } from '@api/rest/github/github.setup';
import { uniqueId } from '@utils/unique';
import { Tag } from '@utils/tags';

test.describe('admin · integration names', () => {
  test(
    'a second QA integration with the same name in another case is refused (409) (TC-ADM-080)',
    { tag: [Tag.regression] },
    async ({ adminApi, integration }) => {
      const name = uniqueId('qa-tool');
      await integration('qa', { name });

      await expectError(await adminApi.createIntegration({ kind: 'qa', name: `  ${name.toUpperCase()} ` }), 409);
    },
  );

  test(
    'the same name on another kind is allowed (TC-ADM-081)',
    { tag: [Tag.regression] },
    async ({ adminApi, integration, cleanup }) => {
      const name = uniqueId('shared');
      await integration('qa', { name });

      const gaos = await expectJson(
        await adminApi.createIntegration({ kind: 'gaos', name }),
        CreatedIntegrationSchema,
        201,
      );
      cleanup.add(() => adminApi.deleteIntegration(gaos.integration.id));

      expect(gaos.integration.name).toBe(name);
    },
  );

  test(
    'renaming a GitHub owner keeps its org and owner type (TC-ADM-082)',
    { tag: [Tag.regression] },
    async ({ adminApi, apiContextFor, cleanup }) => {
      const login = uniqueId('me');
      const { target } = await setupGithub({ apiContextFor, adminApi, cleanup }, { org: login, ownerType: 'user' });
      const name = uniqueId('renamed');

      const renamed = await expectJson(
        await adminApi.updateIntegration(target.id, { name: ` ${name} ` }),
        IntegrationSchema,
      );
      const list = await expectJson(await adminApi.listIntegrations(), IntegrationListSchema);

      expect(renamed).toMatchObject({ id: target.id, kind: 'github', name, org: login, ownerType: 'user' });
      expect(list.find((i) => i.id === target.id)).toMatchObject({ name, org: login, ownerType: 'user' });
    },
  );

  test(
    'renaming to another integration name of the same kind in another case is refused (409) (TC-ADM-083)',
    { tag: [Tag.regression] },
    async ({ adminApi, integration }) => {
      const taken = uniqueId('taken');
      await integration('qa', { name: taken });
      const other = await integration('qa');

      await expectError(await adminApi.updateIntegration(other.id, { name: taken.toUpperCase() }), 409);

      const list = await expectJson(await adminApi.listIntegrations(), IntegrationListSchema);
      expect(list.find((i) => i.id === other.id)?.name).toBe(other.integration.name);
    },
  );

  const invalidNames = [
    { title: 'an empty name', name: '   ' },
    { title: 'a name of 81 characters', name: 'n'.repeat(81) },
  ];
  for (const { title, name } of invalidNames) {
    test(
      `renaming to ${title} is refused (422) and the name is kept (TC-ADM-084)`,
      { tag: [Tag.regression] },
      async ({ adminApi, integration }) => {
        const qa = await integration('qa');

        await expectError(await adminApi.updateIntegration(qa.id, { name }), 422);

        const list = await expectJson(await adminApi.listIntegrations(), IntegrationListSchema);
        expect(list.find((i) => i.id === qa.id)?.name).toBe(qa.integration.name);
      },
    );
  }

  test(
    'renaming an unknown integration is refused (404) (TC-ADM-085)',
    { tag: [Tag.regression] },
    async ({ adminApi }) => {
      await expectError(await adminApi.updateIntegration('qa-000000', { name: uniqueId('x') }), 404);
    },
  );
});
