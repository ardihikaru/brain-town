import { test, expect } from '@fixtures';
import { expectError, expectJson } from '@api/core/assertions';
import { OrgSchema, ProductsSchema } from '@api/rest/admin/admin.schemas';
import type { AdminClient } from '@api/rest/admin/admin.client';
import { uniqueId } from '@utils/unique';
import { Tag } from '@utils/tags';

// An alias that differs from the key is the org's public name, also for a public org. Every test makes its own
// orgs (through a QA integration that references them) and resets what it set, so the tests stay parallel-safe.

interface OrgFixtures {
  adminApi: AdminClient;
  integration: (kind: 'qa', input?: { org?: string }) => Promise<unknown>;
  cleanup: { add: (task: () => Promise<unknown>) => void };
}

/** A fresh public org that exists because a QA integration references it; its alias is reset after the test. */
async function freshOrg({ adminApi, integration, cleanup }: OrgFixtures): Promise<string> {
  const key = uniqueId('org').toLowerCase();
  await integration('qa', { org: key });
  cleanup.add(() => adminApi.putOrg(key, { alias: '' }));
  return key;
}

async function aliasOf(adminApi: AdminClient, key: string): Promise<string | undefined> {
  const { orgs } = await expectJson(await adminApi.products(), ProductsSchema);
  return orgs.find((o) => o.key === key)?.alias;
}

test.describe('admin · org alias', () => {
  test(
    'a custom alias of a public org is saved and products lists it (TC-ADM-090)',
    { tag: [Tag.smoke] },
    async ({ adminApi, integration, cleanup }) => {
      const key = await freshOrg({ adminApi, integration, cleanup });
      const alias = uniqueId('Town Name');

      const saved = await expectJson(await adminApi.putOrg(key, { alias }), OrgSchema);

      expect(saved).toMatchObject({ key, visibility: 'public', alias });
      expect(await aliasOf(adminApi, key)).toBe(alias);
    },
  );

  test(
    'an empty alias resets the org to its key (TC-ADM-091)',
    { tag: [Tag.regression] },
    async ({ adminApi, integration, cleanup }) => {
      const key = await freshOrg({ adminApi, integration, cleanup });
      await expectJson(await adminApi.putOrg(key, { alias: uniqueId('Town Name') }), OrgSchema);

      const reset = await expectJson(await adminApi.putOrg(key, { alias: '' }), OrgSchema);

      expect(reset).toMatchObject({ key, visibility: 'public', alias: key });
      expect(await aliasOf(adminApi, key)).toBe(key);
    },
  );

  test(
    'an alias equal to another org alias, in any case, gives 409 and keeps the old alias (TC-ADM-092)',
    { tag: [Tag.regression] },
    async ({ adminApi, integration, cleanup }) => {
      const first = await freshOrg({ adminApi, integration, cleanup });
      const second = await freshOrg({ adminApi, integration, cleanup });
      const taken = uniqueId('Taken Name');
      const own = uniqueId('Own Name');
      await expectJson(await adminApi.putOrg(first, { alias: taken }), OrgSchema);
      await expectJson(await adminApi.putOrg(second, { alias: own }), OrgSchema);

      await expectError(await adminApi.putOrg(second, { alias: taken.toUpperCase() }), 409);

      expect(await aliasOf(adminApi, second)).toBe(own);
    },
  );

  test(
    'an alias equal to another org key gives 409 (TC-ADM-093)',
    { tag: [Tag.regression] },
    async ({ adminApi, integration, cleanup }) => {
      const first = await freshOrg({ adminApi, integration, cleanup });
      const second = await freshOrg({ adminApi, integration, cleanup });

      await expectError(await adminApi.putOrg(second, { alias: first.toUpperCase() }), 409);

      expect(await aliasOf(adminApi, second)).toBe(second);
    },
  );

  const invalid = [
    { id: 'TC-ADM-094', name: '61 characters', alias: 'a'.repeat(61) },
    { id: 'TC-ADM-095', name: 'a character outside the allowed set (<)', alias: 'Bad <b> name' },
  ];
  for (const row of invalid) {
    test(
      `an alias with ${row.name} gives 422 and keeps the old alias (${row.id})`,
      { tag: [Tag.regression] },
      async ({ adminApi, integration, cleanup }) => {
        const key = await freshOrg({ adminApi, integration, cleanup });
        const own = uniqueId('Own Name');
        await expectJson(await adminApi.putOrg(key, { alias: own }), OrgSchema);

        await expectError(await adminApi.putOrg(key, { alias: row.alias }), 422);

        expect(await aliasOf(adminApi, key)).toBe(own);
      },
    );
  }
});
