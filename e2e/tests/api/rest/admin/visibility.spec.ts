import { test, expect } from '@fixtures';
import { expectError, expectJson, expectStatus } from '@api/core/assertions';
import { OrgSchema, ProductSchema, ProductsSchema } from '@api/rest/admin/admin.schemas';
import { buildGaosProduct, buildGaosTask } from '@data/factories/gaos.factory';
import { buildQaRun, buildQaRunStarted } from '@data/factories/qa.factory';
import { uniqueId } from '@utils/unique';
import { Tag } from '@utils/tags';

// Orgs and products are created by the events that mention them and cannot be deleted; every test uses
// unique keys, so nothing another test owns is touched.

test.describe('admin · products and visibility', () => {
  test(
    'a product named by an event appears with its source and the visibility its sender reported (TC-ADM-030)',
    {
      tag: [Tag.smoke],
    },
    async ({ adminApi, ingestApi, integration }) => {
      const gaos = await integration('gaos');
      const product = buildGaosProduct();
      await expectStatus(await ingestApi.send(gaos.ingestPath, buildGaosTask({ product }), { token: gaos.token }), 202);

      const { products } = await expectJson(await adminApi.products(), ProductsSchema);

      expect(products.find((p) => p.key === product.key)).toMatchObject({
        key: product.key,
        name: product.name,
        visibility: 'public',
        alias: product.key,
        hall: 'Article Bureau',
        sources: ['GAOS'],
      });
    },
  );

  test(
    'a product its sender reports as hidden is created hidden under a "Product X" alias (TC-ADM-031)',
    {
      tag: [Tag.regression],
    },
    async ({ adminApi, ingestApi, integration }) => {
      const gaos = await integration('gaos');
      const product = buildGaosProduct({ visibility: 'hidden' });
      await expectStatus(await ingestApi.send(gaos.ingestPath, buildGaosTask({ product }), { token: gaos.token }), 202);

      const { products } = await expectJson(await adminApi.products(), ProductsSchema);

      const stored = products.find((p) => p.key === product.key);
      expect(stored?.visibility).toBe('hidden');
      expect(stored?.alias).toMatch(/^Product /);
      expect(stored?.alias).not.toBe(product.key);
    },
  );

  test(
    'the back-office can hide a product under a custom alias and make it public again (TC-ADM-032)',
    {
      tag: [Tag.regression],
    },
    async ({ adminApi, ingestApi, integration }) => {
      const gaos = await integration('gaos');
      const product = buildGaosProduct();
      await expectStatus(await ingestApi.send(gaos.ingestPath, buildGaosTask({ product }), { token: gaos.token }), 202);
      const alias = uniqueId('Alias');

      const hidden = await expectJson(
        await adminApi.putProduct(product.key, { visibility: 'hidden', alias, hall: 'Imago' }),
        ProductSchema,
      );
      const publicAgain = await expectJson(
        await adminApi.putProduct(product.key, { visibility: 'public' }),
        ProductSchema,
      );

      expect(hidden).toMatchObject({ key: product.key, visibility: 'hidden', alias, hall: 'Imago' });
      expect(publicAgain).toMatchObject({ visibility: 'public', alias: product.key, hall: 'Imago' });
    },
  );

  test(
    'the back-office can hide an org under a custom alias (TC-ADM-034)',
    { tag: [Tag.regression] },
    async ({ adminApi, ingestApi, integration }) => {
      const qa = await integration('qa');
      const run = buildQaRun();
      await expectStatus(await ingestApi.send(qa.ingestPath, buildQaRunStarted(run), { token: qa.token }), 202);
      const alias = uniqueId('Org');

      const org = await expectJson(await adminApi.putOrg(run.org, { visibility: 'hidden', alias }), OrgSchema);
      const { orgs } = await expectJson(await adminApi.products(), ProductsSchema);

      expect(org).toEqual({ key: run.org, visibility: 'hidden', alias });
      expect(orgs.find((o) => o.key === run.org)).toEqual(org);
    },
  );

  test(
    'a visibility other than public or hidden is refused (422) (TC-ADM-033)',
    { tag: [Tag.regression] },
    async ({ adminApi, ingestApi, integration }) => {
      const gaos = await integration('gaos');
      const product = buildGaosProduct();
      await expectStatus(await ingestApi.send(gaos.ingestPath, buildGaosTask({ product }), { token: gaos.token }), 202);

      await expectError(await adminApi.putProduct(product.key, { visibility: 'secret' }), 422);
    },
  );

  test('an unknown product or org answers 404 (TC-ADM-033)', { tag: [Tag.regression] }, async ({ adminApi }) => {
    await expectError(await adminApi.putProduct(uniqueId('nope'), { visibility: 'hidden' }), 404);
    await expectError(await adminApi.putOrg(uniqueId('nope'), { visibility: 'hidden' }), 404);
  });
});
