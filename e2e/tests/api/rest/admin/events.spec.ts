import { test, expect } from '@fixtures';
import { expectJson, expectStatus } from '@api/core/assertions';
import { AdminEventListSchema } from '@api/rest/admin/admin.schemas';
import { buildGaosTask, buildGaosTaskInfo } from '@data/factories/gaos.factory';
import { omit } from '@data/factories/mutate';
import { Tag } from '@utils/tags';

test.describe('admin · event log', () => {
  test(
    'an accepted delivery is listed with its raw payload and its public view (TC-ADM-040)',
    {
      tag: [Tag.smoke],
    },
    async ({ adminApi, ingestApi, integration }) => {
      const gaos = await integration('gaos');
      const envelope = buildGaosTask();
      await expectStatus(await ingestApi.send(gaos.ingestPath, envelope, { token: gaos.token }), 202);

      const events = await expectJson(await adminApi.events({ integration: gaos.id }), AdminEventListSchema);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        id: envelope.id,
        integration: gaos.id,
        kind: 'gaos',
        type: 'task.created',
        delivery: 'ok',
        status: 202,
        product: envelope.product.key,
        raw: envelope,
        public: { id: envelope.id, type: 'task.created', source: 'gaos', payload: envelope },
      });
    },
  );

  test(
    'filters narrow the log by delivery, type prefix and text (TC-ADM-041)',
    { tag: [Tag.regression] },
    async ({ adminApi, ingestApi, integration }) => {
      const gaos = await integration('gaos');
      const task = buildGaosTaskInfo();
      const accepted = buildGaosTask({ task });
      await expectStatus(await ingestApi.send(gaos.ingestPath, accepted, { token: gaos.token }), 202);
      await expectStatus(
        await ingestApi.send(gaos.ingestPath, omit(buildGaosTask(), 'product.key'), { token: gaos.token }),
        422,
      );

      const rejected = await expectJson(
        await adminApi.events({ integration: gaos.id, delivery: 'rejected' }),
        AdminEventListSchema,
      );
      const byType = await expectJson(
        await adminApi.events({ integration: gaos.id, type: 'task.' }),
        AdminEventListSchema,
      );
      const byText = await expectJson(
        await adminApi.events({ integration: gaos.id, q: task.title }),
        AdminEventListSchema,
      );

      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({ delivery: 'rejected', status: 422, type: 'task.created', id: '' });
      expect(rejected[0]?.reason).toContain('product.key');
      expect(byType.map((e) => e.delivery).sort()).toEqual(['ok', 'rejected']);
      expect(byText.map((e) => e.id)).toEqual([accepted.id]);
    },
  );
});
