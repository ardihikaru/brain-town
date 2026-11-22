import { test, expect } from '@fixtures';
import { expectError, expectJson, expectStatus } from '@api/core/assertions';
import { AdminEventListSchema } from '@api/rest/admin/admin.schemas';
import { AcceptedSchema } from '@api/rest/ingest/ingest.schemas';
import {
  buildGaosMove,
  buildGaosProduct,
  buildGaosProductUpserted,
  buildGaosTask,
  buildGaosTaskInfo,
} from '@data/factories/gaos.factory';
import { omit, withValue } from '@data/factories/mutate';
import { uniqueId } from '@utils/unique';
import { Tag } from '@utils/tags';

test.describe('ingest · gaos', () => {
  test(
    'a valid GAOS event is accepted (202) and stored (TC-ING-001)',
    { tag: [Tag.smoke] },
    async ({ adminApi, ingestApi, integration }) => {
      const gaos = await integration('gaos');
      const product = buildGaosProduct();
      const task = buildGaosTaskInfo();
      const created = buildGaosTask({ product, task });
      const moved = buildGaosMove(product, task, 'working');

      await expectJson(
        await ingestApi.send(gaos.ingestPath, created, { token: gaos.token, idempotencyKey: created.id }),
        AcceptedSchema,
        202,
      );
      await expectJson(await ingestApi.send(gaos.ingestPath, moved, { token: gaos.token }), AcceptedSchema, 202);

      const events = await expectJson(await adminApi.events({ integration: gaos.id }), AdminEventListSchema);
      expect(events.map((e) => e.id)).toEqual([moved.id, created.id]);
    },
  );

  test('product.upserted needs no task (TC-ING-005)', { tag: [Tag.regression] }, async ({ ingestApi, integration }) => {
    const gaos = await integration('gaos');

    await expectJson(
      await ingestApi.send(gaos.ingestPath, buildGaosProductUpserted(), { token: gaos.token }),
      AcceptedSchema,
      202,
    );
  });

  test(
    'the same event id twice is a duplicate (409, field id) (TC-ING-002)',
    { tag: [Tag.smoke] },
    async ({ ingestApi, integration }) => {
      const gaos = await integration('gaos');
      const envelope = buildGaosTask();
      await expectStatus(await ingestApi.send(gaos.ingestPath, envelope, { token: gaos.token }), 202);

      await expectError(await ingestApi.send(gaos.ingestPath, envelope, { token: gaos.token }), 409, 'id');
    },
  );

  test(
    'Idempotency-Key wins over the body id for duplicates (409) (TC-ING-003)',
    { tag: [Tag.regression] },
    async ({ ingestApi, integration }) => {
      const gaos = await integration('gaos');
      const key = uniqueId('key');
      await expectStatus(
        await ingestApi.send(gaos.ingestPath, buildGaosTask(), { token: gaos.token, idempotencyKey: key }),
        202,
      );

      const second = await ingestApi.send(gaos.ingestPath, buildGaosTask(), { token: gaos.token, idempotencyKey: key });

      await expectError(second, 409, 'id');
    },
  );

  const invalid: { title: string; field: string; body: () => Record<string, unknown> }[] = [
    { title: 'no id', field: 'id', body: () => omit(buildGaosTask(), 'id') },
    { title: 'an id over 128 characters', field: 'id', body: () => withValue(buildGaosTask(), 'id', 'x'.repeat(129)) },
    { title: 'no at', field: 'at', body: () => omit(buildGaosTask(), 'at') },
    {
      title: 'an at that is not RFC 3339',
      field: 'at',
      body: () => withValue(buildGaosTask(), 'at', '22/11/2026 09:00'),
    },
    { title: 'an unknown type', field: 'type', body: () => withValue(buildGaosTask(), 'type', 'task.exploded') },
    { title: 'a QA type', field: 'type', body: () => withValue(buildGaosTask(), 'type', 'qa.step') },
    { title: 'no product.key', field: 'product.key', body: () => omit(buildGaosTask(), 'product.key') },
    {
      title: 'a product.visibility other than public/hidden',
      field: 'product.visibility',
      body: () => withValue(buildGaosTask(), 'product.visibility', 'secret'),
    },
    { title: 'no task.id on a task event', field: 'task.id', body: () => omit(buildGaosTask(), 'task.id') },
  ];
  for (const { title, field, body } of invalid) {
    test(
      `a GAOS event with ${title} is refused (422, field ${field}) (TC-ING-004)`,
      {
        tag: [Tag.regression],
      },
      async ({ ingestApi, integration }) => {
        const gaos = await integration('gaos');

        await expectError(await ingestApi.send(gaos.ingestPath, body(), { token: gaos.token }), 422, field);
      },
    );
  }

  test(
    'an id of exactly 128 characters is accepted (TC-ING-004)',
    { tag: [Tag.regression] },
    async ({ ingestApi, integration }) => {
      const gaos = await integration('gaos');
      const id = uniqueId('max').padEnd(128, 'x');

      await expectStatus(await ingestApi.send(gaos.ingestPath, buildGaosTask({ id }), { token: gaos.token }), 202);
    },
  );
});
