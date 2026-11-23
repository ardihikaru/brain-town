import { test, expect } from '@fixtures';
import { expectJson } from '@api/core/assertions';
import { OrgSchema, ProductsSchema } from '@api/rest/admin/admin.schemas';
import { setupGithub } from '@api/rest/github/github.setup';
import type { AdminClient } from '@api/rest/admin/admin.client';
import { uniqueId } from '@utils/unique';
import { Tag } from '@utils/tags';

// Arrange via API (a GitHub owner) → act on the owner page's org alias editor → assert in the page and via the API.

async function aliasOf(adminApi: AdminClient, key: string): Promise<string | undefined> {
  const { orgs } = await expectJson(await adminApi.products(), ProductsSchema);
  return orgs.find((o) => o.key === key)?.alias;
}

test.describe('backoffice · org alias', () => {
  test(
    'an org alias typed on the owner page is saved with Enter and the note says where it shows (TC-BO-060)',
    { tag: [Tag.smoke] },
    async ({ backoffice, apiContextFor, adminApi, cleanup }) => {
      const login = uniqueId('me').toLowerCase();
      const alias = uniqueId('Town Name');
      const { target } = await setupGithub({ apiContextFor, adminApi, cleanup }, { org: login, ownerType: 'user' });
      cleanup.add(() => adminApi.putOrg(login, { alias: '' }));
      await backoffice.owner.open(target.id);

      await backoffice.owner.setOrgAlias(alias);

      await expect(backoffice.owner.orgAlias().note).toHaveText(`Shown in town as “${alias}”.`);
      await expect(backoffice.owner.orgAlias().error).toBeHidden();
      await expect.poll(() => aliasOf(adminApi, login), { message: 'the alias is saved' }).toBe(alias);
    },
  );

  test(
    'an org alias already used by another org shows the 409 error inline and keeps the old alias (TC-BO-061)',
    { tag: [Tag.regression] },
    async ({ backoffice, apiContextFor, adminApi, integration, cleanup }) => {
      const login = uniqueId('me').toLowerCase();
      const other = uniqueId('org').toLowerCase();
      const taken = uniqueId('Taken Name');
      const own = uniqueId('Own Name');
      const { target } = await setupGithub({ apiContextFor, adminApi, cleanup }, { org: login, ownerType: 'user' });
      await integration('qa', { org: other });
      cleanup.add(() => adminApi.putOrg(login, { alias: '' }));
      cleanup.add(() => adminApi.putOrg(other, { alias: '' }));
      await expectJson(await adminApi.putOrg(other, { alias: taken }), OrgSchema);
      await expectJson(await adminApi.putOrg(login, { alias: own }), OrgSchema);
      await backoffice.owner.open(target.id);
      await expect(backoffice.owner.orgAlias().note).toHaveText(`Shown in town as “${own}”.`);

      await backoffice.owner.setOrgAlias(taken);

      await expect(backoffice.owner.orgAlias().error).toBeVisible();
      await expect(backoffice.owner.orgAlias().note).toHaveText(`Shown in town as “${own}”.`);
      expect(await aliasOf(adminApi, login)).toBe(own);
    },
  );
});
