import { test, expect } from '@fixtures';
import { expectJson } from '@api/core/assertions';
import { IntegrationListSchema } from '@api/rest/admin/admin.schemas';
import { setupGithub } from '@api/rest/github/github.setup';
import { uniqueId } from '@utils/unique';
import { Tag } from '@utils/tags';

// Arrange via API → act in the back-office forms and cards → assert in the page and via the API.

test.describe('backoffice · named QA integrations and rename', () => {
  test(
    'creating a QA integration with a name and an org opens its setup page and its card shows the org (TC-BO-050)',
    { tag: [Tag.smoke] },
    async ({ backoffice, page, adminApi, cleanup }) => {
      const name = uniqueId('QA Form');
      const org = uniqueId('org').toLowerCase();
      await backoffice.integrations.goto();

      await backoffice.integrations.createQa(name, org);

      await expect(page).toHaveURL(/#setup-qa-[0-9a-f]{6}$/);
      const id = backoffice.setup.integrationId();
      cleanup.add(() => adminApi.deleteIntegration(id));
      await backoffice.setup.expectLoaded();
      await backoffice.integrations.goto();
      await expect(backoffice.integrations.name(id)).toHaveText(name);
      await expect(backoffice.integrations.qaCardOrg(id)).toContainText(org);
      const list = await expectJson(await adminApi.listIntegrations(), IntegrationListSchema);
      expect(list.find((i) => i.id === id)).toMatchObject({ kind: 'qa', name, org });
    },
  );

  test(
    'creating a QA integration with a name already used by another QA integration shows the name error (TC-BO-051)',
    { tag: [Tag.regression] },
    async ({ backoffice, page, integration }) => {
      const name = uniqueId('QA Taken');
      await integration('qa', { name });
      await backoffice.integrations.goto();

      await backoffice.integrations.createQa(name.toUpperCase());

      await expect(backoffice.integrations.qaNameError).toBeVisible();
      await expect(page).not.toHaveURL(/#setup-qa-/);
    },
  );

  test(
    'a QA card is renamed with Enter and the new name is stored (TC-BO-052)',
    { tag: [Tag.smoke] },
    async ({ backoffice, adminApi, integration }) => {
      const qa = await integration('qa', { name: uniqueId('QA Before') });
      const renamed = uniqueId('QA After');
      await backoffice.integrations.goto();
      await expect(backoffice.integrations.name(qa.id)).toHaveText(qa.integration.name);

      await backoffice.integrations.rename(qa.id, renamed);

      await expect(backoffice.integrations.name(qa.id)).toHaveText(renamed);
      await expect(backoffice.integrations.renameForm).toBeHidden();
      const list = await expectJson(await adminApi.listIntegrations(), IntegrationListSchema);
      expect(list.find((i) => i.id === qa.id)?.name).toBe(renamed);
    },
  );

  test(
    'a GitHub owner card is renamed and still shows its @login (TC-BO-053)',
    { tag: [Tag.regression] },
    async ({ backoffice, adminApi, apiContextFor, cleanup }) => {
      const login = uniqueId('me');
      const { target } = await setupGithub({ apiContextFor, adminApi, cleanup }, { org: login, ownerType: 'user' });
      const renamed = uniqueId('Home');
      await backoffice.integrations.goto();
      await expect(backoffice.integrations.ownerCard(target.id)).toBeVisible();

      await backoffice.integrations.rename(target.id, renamed);

      await expect(backoffice.integrations.name(target.id)).toHaveText(renamed);
      await expect(backoffice.integrations.ownerLogin(target.id)).toHaveText(`@${login}`);
      const list = await expectJson(await adminApi.listIntegrations(), IntegrationListSchema);
      expect(list.find((i) => i.id === target.id)).toMatchObject({ name: renamed, org: login });
    },
  );

  test(
    'renaming a QA card to another QA name shows the rename error and keeps the name (TC-BO-054)',
    { tag: [Tag.regression] },
    async ({ backoffice, integration }) => {
      const taken = uniqueId('QA Used');
      await integration('qa', { name: taken });
      const qa = await integration('qa', { name: uniqueId('QA Mine') });
      await backoffice.integrations.goto();
      await expect(backoffice.integrations.name(qa.id)).toHaveText(qa.integration.name);

      await backoffice.integrations.rename(qa.id, taken.toUpperCase());

      await expect(backoffice.integrations.renameError).toBeVisible();
      await expect(backoffice.integrations.renameInput).toBeFocused();
    },
  );
});
