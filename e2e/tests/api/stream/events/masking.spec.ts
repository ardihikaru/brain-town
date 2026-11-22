import { test, expect } from '@fixtures';
import { expectJson, expectStatus } from '@api/core/assertions';
import { AdminEventSchema, OrgSchema, ProductSchema, PublicEventSchema } from '@api/rest/admin/admin.schemas';
import { buildGaosProduct, buildGaosTask, buildGaosTaskInfo } from '@data/factories/gaos.factory';
import { buildQaRun, buildQaRunStarted, buildQaStep } from '@data/factories/qa.factory';
import { uniqueId } from '@utils/unique';
import { Tag } from '@utils/tags';

test.describe('stream · masking of hidden products and orgs', () => {
  test(
    'a product hidden in the back-office shows only its alias and no task title (TC-STR-010)',
    {
      tag: [Tag.smoke],
    },
    async ({ adminApi, sse, ingestApi, integration }) => {
      const gaos = await integration('gaos');
      const product = buildGaosProduct();
      await expectStatus(await ingestApi.send(gaos.ingestPath, buildGaosTask({ product }), { token: gaos.token }), 202);
      const alias = uniqueId('Secret');
      await expectJson(await adminApi.putProduct(product.key, { visibility: 'hidden', alias }), ProductSchema);
      const stream = await sse.connect('public');
      const task = buildGaosTaskInfo();
      const envelope = buildGaosTask({ product, task });

      await expectStatus(await ingestApi.send(gaos.ingestPath, envelope, { token: gaos.token }), 202);

      const body = await stream.waitForJson(PublicEventSchema, (e) => e.id === envelope.id);
      expect(body.payload.product).toEqual({ key: alias, name: alias, visibility: 'hidden' });
      expect(body.payload.task).toEqual({ id: task.id, kind: task.kind, column: task.column });
      expect(JSON.stringify(body)).not.toContain(task.title);
      expect(JSON.stringify(body)).not.toContain(product.key);
    },
  );

  test(
    'a product its sender reports as hidden is masked from its first event (TC-STR-011)',
    {
      tag: [Tag.regression],
    },
    async ({ sse, ingestApi, integration }) => {
      const gaos = await integration('gaos');
      const stream = await sse.connect('public');
      const product = buildGaosProduct({ visibility: 'hidden' });
      const task = buildGaosTaskInfo();
      const envelope = buildGaosTask({ product, task });

      await expectStatus(await ingestApi.send(gaos.ingestPath, envelope, { token: gaos.token }), 202);

      const body = await stream.waitForJson(PublicEventSchema, (e) => e.id === envelope.id);
      expect(body.payload.product).toMatchObject({ visibility: 'hidden' });
      expect(JSON.stringify(body)).not.toContain(task.title);
      expect(JSON.stringify(body)).not.toContain(product.key);
    },
  );

  test(
    'a hidden org masks QA events: org and product become the org alias, step and spec are removed (TC-STR-012)',
    {
      tag: [Tag.regression],
    },
    async ({ adminApi, sse, ingestApi, integration }) => {
      const qa = await integration('qa');
      const run = buildQaRun();
      await expectStatus(await ingestApi.send(qa.ingestPath, buildQaRunStarted(run), { token: qa.token }), 202);
      const alias = uniqueId('Org');
      await expectJson(await adminApi.putOrg(run.org, { visibility: 'hidden', alias }), OrgSchema);
      const stream = await sse.connect('public');
      const step = buildQaStep(run, 0, 'Open the private dashboard');

      await expectStatus(await ingestApi.send(qa.ingestPath, step, { token: qa.token }), 202);

      const body = await stream.waitForJson(PublicEventSchema, (e) => e.id === step.id);
      expect(body.payload).toMatchObject({ org: alias, product: alias, run: run.run });
      expect(body.payload.data).toEqual({ index: 0, status: 'passed', duration_ms: 120 });
      expect(JSON.stringify(body)).not.toContain(run.org);
      expect(JSON.stringify(body)).not.toContain(run.product);
    },
  );

  test(
    '/admin/events carries the raw delivery next to the masked public view (TC-STR-013)',
    {
      tag: [Tag.regression],
    },
    async ({ sse, ingestApi, integration }) => {
      const gaos = await integration('gaos');
      const stream = await sse.connect('admin');
      const product = buildGaosProduct({ visibility: 'hidden' });
      const task = buildGaosTaskInfo();
      const envelope = buildGaosTask({ product, task });

      await expectStatus(await ingestApi.send(gaos.ingestPath, envelope, { token: gaos.token }), 202);

      const body = await stream.waitForJson(AdminEventSchema, (e) => e.id === envelope.id);
      expect(body.raw).toEqual(envelope);
      expect(body.delivery).toBe('ok');
      expect(JSON.stringify(body.public)).not.toContain(task.title);
    },
  );
});
