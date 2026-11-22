import { test, expect } from '@fixtures';
import { expectError, expectJson, expectStatus } from '@api/core/assertions';
import { AdminEventListSchema } from '@api/rest/admin/admin.schemas';
import { buildGaosTask } from '@data/factories/gaos.factory';
import { buildQaRunStarted } from '@data/factories/qa.factory';
import { Tag } from '@utils/tags';

test.describe('ingest · authentication', () => {
  test(
    'no Authorization header is refused (401) (TC-ING-030)',
    { tag: [Tag.smoke] },
    async ({ ingestApi, integration }) => {
      const gaos = await integration('gaos');

      await expectError(await ingestApi.send(gaos.ingestPath, buildGaosTask()), 401);
    },
  );

  test(
    'a wrong token is refused (401) and logged as a rejected delivery (TC-ING-030)',
    {
      tag: [Tag.regression],
    },
    async ({ adminApi, ingestApi, integration }) => {
      const gaos = await integration('gaos');

      await expectError(await ingestApi.send(gaos.ingestPath, buildGaosTask(), { token: `${gaos.token}x` }), 401);

      const rejected = await expectJson(
        await adminApi.events({ integration: gaos.id, delivery: 'rejected' }),
        AdminEventListSchema,
      );
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.status).toBe(401);
    },
  );

  test(
    "another integration's token is refused (401) (TC-ING-030)",
    { tag: [Tag.regression] },
    async ({ ingestApi, integration }) => {
      const first = await integration('gaos');
      const second = await integration('gaos');

      await expectError(await ingestApi.send(second.ingestPath, buildGaosTask(), { token: first.token }), 401);
    },
  );

  test(
    'a valid token on the endpoint of another source is refused (401) (TC-ING-030)',
    {
      tag: [Tag.regression],
    },
    async ({ ingestApi, integration }) => {
      const gaos = await integration('gaos');

      await expectError(await ingestApi.send(`/ingest/qa/${gaos.id}`, buildQaRunStarted(), { token: gaos.token }), 401);
    },
  );

  test(
    'an unknown integration id is refused (401) (TC-ING-030)',
    { tag: [Tag.regression] },
    async ({ ingestApi, integration }) => {
      const gaos = await integration('gaos');

      await expectError(await ingestApi.send('/ingest/gaos/gaos-ffffff', buildGaosTask(), { token: gaos.token }), 401);
    },
  );

  test(
    'an unknown source path answers 404 (TC-ING-031)',
    { tag: [Tag.regression] },
    async ({ ingestApi, integration }) => {
      const gaos = await integration('gaos');

      await expectStatus(
        await ingestApi.send(`/ingest/unknown/${gaos.id}`, buildGaosTask(), { token: gaos.token }),
        404,
      );
    },
  );
});

test.describe('ingest · body', () => {
  const bodies: { title: string; body: () => string }[] = [
    { title: 'a body that is not JSON', body: () => 'id=1&type=task.created' },
    { title: 'a JSON array', body: () => JSON.stringify([buildGaosTask()]) },
    { title: 'a JSON null', body: () => 'null' },
    {
      title: 'a body over 64 KiB',
      body: () => JSON.stringify(buildGaosTask({ data: { padding: 'x'.repeat(65 * 1024) } })),
    },
  ];
  for (const { title, body } of bodies) {
    test(
      `${title} is refused (422, field body) (TC-ING-032)`,
      { tag: [Tag.regression] },
      async ({ ingestApi, integration }) => {
        const gaos = await integration('gaos');

        await expectError(await ingestApi.sendRaw(gaos.ingestPath, body(), { token: gaos.token }), 422, 'body');
      },
    );
  }
});
