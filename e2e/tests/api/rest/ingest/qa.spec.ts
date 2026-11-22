import { test, expect } from '@fixtures';
import { expectError, expectJson } from '@api/core/assertions';
import { AdminEventListSchema } from '@api/rest/admin/admin.schemas';
import { AcceptedSchema } from '@api/rest/ingest/ingest.schemas';
import { buildQaRun, buildQaRunFinished, buildQaRunStarted, buildQaStep } from '@data/factories/qa.factory';
import { omit, withValue } from '@data/factories/mutate';
import { Tag } from '@utils/tags';

test.describe('ingest · qa', () => {
  test(
    'a full QA run (started, steps, finished) is accepted in order (TC-ING-010)',
    { tag: [Tag.smoke] },
    async ({ adminApi, ingestApi, integration }) => {
      const qa = await integration('qa');
      const run = buildQaRun();
      const events = [
        buildQaRunStarted(run),
        buildQaStep(run, 0, 'Open page'),
        buildQaStep(run, 1, 'Sign in', 'failed'),
        buildQaRunFinished(run, 1, 1),
      ];

      for (const envelope of events) {
        await test.step(envelope.type, async () => {
          await expectJson(await ingestApi.send(qa.ingestPath, envelope, { token: qa.token }), AcceptedSchema, 202);
        });
      }

      const stored = await expectJson(await adminApi.events({ integration: qa.id }), AdminEventListSchema);
      expect(stored.map((e) => e.id).reverse()).toEqual(events.map((e) => e.id));
      expect(stored.every((e) => e.product === run.product && e.org === run.org)).toBe(true);
    },
  );

  const invalid: { title: string; field: string; body: () => Record<string, unknown> }[] = [
    { title: 'no id', field: 'id', body: () => omit(buildQaRunStarted(), 'id') },
    { title: 'no at', field: 'at', body: () => omit(buildQaRunStarted(), 'at') },
    { title: 'a GAOS type', field: 'type', body: () => withValue(buildQaRunStarted(), 'type', 'task.created') },
    { title: 'no product', field: 'product', body: () => omit(buildQaRunStarted(), 'product') },
    { title: 'no run', field: 'run', body: () => omit(buildQaRunStarted(), 'run') },
  ];
  for (const { title, field, body } of invalid) {
    test(
      `a QA event with ${title} is refused (422, field ${field}) (TC-ING-011)`,
      {
        tag: [Tag.regression],
      },
      async ({ ingestApi, integration }) => {
        const qa = await integration('qa');

        await expectError(await ingestApi.send(qa.ingestPath, body(), { token: qa.token }), 422, field);
      },
    );
  }
});
