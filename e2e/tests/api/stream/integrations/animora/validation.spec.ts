import { test, expect } from '@fixtures';
import { expectError, expectJson, expectStatus } from '@api/core/assertions';
import { AdminEventListSchema } from '@api/rest/admin/admin.schemas';
import {
  buildChannelConnected,
  buildVideoParts,
  buildVideoPublished,
  buildVideoRendered,
  buildVideoScheduled,
  without,
  type AnimoraEnvelope,
} from '@data/factories/animora.factory';
import { buildGaosTask } from '@data/factories/gaos.factory';
import { Tag } from '@utils/tags';

test.describe('animora · duplicates and validation', () => {
  test(
    'sending the same id twice is refused the second time (409) (TC-INTG-090)',
    { tag: [Tag.smoke] },
    async ({ ingestApi, integration }) => {
      const animora = await integration('animora');
      const envelope = buildVideoRendered();
      await expectStatus(await ingestApi.send(animora.ingestPath, envelope, { token: animora.token }), 202);

      await expectError(await ingestApi.send(animora.ingestPath, envelope, { token: animora.token }), 409, 'id');
    },
  );

  test(
    'a repeated Idempotency-Key is refused even with another id (409) (TC-INTG-091)',
    { tag: [Tag.regression] },
    async ({ ingestApi, integration }) => {
      const animora = await integration('animora');
      const key = buildVideoRendered().id;
      await expectStatus(
        await ingestApi.send(animora.ingestPath, buildVideoRendered(), { token: animora.token, idempotencyKey: key }),
        202,
      );

      await expectError(
        await ingestApi.send(animora.ingestPath, buildVideoRendered(), { token: animora.token, idempotencyKey: key }),
        409,
        'id',
      );
    },
  );

  interface InvalidCase {
    tc: string;
    name: string;
    envelope: () => AnimoraEnvelope;
    field: string;
  }
  const invalid: InvalidCase[] = [
    {
      tc: 'TC-INTG-092',
      name: 'a vendor outside the four platforms',
      envelope: () =>
        buildVideoPublished(buildVideoParts(), { data: { ...buildVideoPublished().data, vendor: 'myspace' } }),
      field: 'data.vendor',
    },
    {
      tc: 'TC-INTG-093',
      name: 'a publication without a title',
      envelope: () => buildVideoPublished(buildVideoParts(), { data: without(buildVideoPublished().data, 'title') }),
      field: 'data.title',
    },
    {
      tc: 'TC-INTG-094',
      name: 'a publication with an http url',
      envelope: () =>
        buildVideoPublished(buildVideoParts(), {
          data: { ...buildVideoPublished().data, url: 'http://youtube.example.test/watch/x' },
        }),
      field: 'data.url',
    },
    {
      tc: 'TC-INTG-095',
      name: 'a schedule with a bad dueAt',
      envelope: () =>
        buildVideoScheduled(buildVideoParts(), { data: { ...buildVideoScheduled().data, dueAt: 'tomorrow' } }),
      field: 'data.dueAt',
    },
    {
      tc: 'TC-INTG-096',
      name: 'a publication with a bad publishedAt',
      envelope: () =>
        buildVideoPublished(buildVideoParts(), { data: { ...buildVideoPublished().data, publishedAt: 'yesterday' } }),
      field: 'data.publishedAt',
    },
    {
      tc: 'TC-INTG-097',
      name: 'a connected account without a channel',
      envelope: () => buildChannelConnected(buildVideoParts(), { data: { vendor: 'youtube', account: 'Akun' } }),
      field: 'data.channel',
    },
    {
      tc: 'TC-INTG-098',
      name: 'an unknown event type',
      envelope: () => buildVideoRendered(buildVideoParts(), { type: 'video.deleted' }),
      field: 'type',
    },
  ];
  for (const { tc, name, envelope, field } of invalid) {
    test(
      `${name} is refused (422) naming ${field} (${tc})`,
      { tag: [Tag.regression] },
      async ({ adminApi, ingestApi, integration }) => {
        const animora = await integration('animora');
        const body = envelope();

        await expectError(await ingestApi.send(animora.ingestPath, body, { token: animora.token }), 422, field);

        const rejected = await expectJson(
          await adminApi.events({ integration: animora.id, delivery: 'rejected' }),
          AdminEventListSchema,
        );
        expect(rejected.map((e) => e.status)).toEqual([422]);
      },
    );
  }
});

test.describe('animora · authentication', () => {
  test(
    'no Authorization header is refused (401) (TC-INTG-100)',
    { tag: [Tag.smoke] },
    async ({ ingestApi, integration }) => {
      const animora = await integration('animora');

      await expectError(await ingestApi.send(animora.ingestPath, buildVideoRendered()), 401);
    },
  );

  test(
    'a wrong token is refused (401) (TC-INTG-101)',
    { tag: [Tag.regression] },
    async ({ ingestApi, integration }) => {
      const animora = await integration('animora');

      await expectError(
        await ingestApi.send(animora.ingestPath, buildVideoRendered(), { token: `${animora.token}x` }),
        401,
      );
    },
  );

  test(
    'the token of another kind of integration is refused on an animora endpoint (401) (TC-INTG-102)',
    { tag: [Tag.regression] },
    async ({ ingestApi, integration }) => {
      const animora = await integration('animora');
      const gaos = await integration('gaos');

      await expectError(await ingestApi.send(animora.ingestPath, buildVideoRendered(), { token: gaos.token }), 401);
    },
  );

  test(
    'an animora token is refused on the endpoint of another source (401) (TC-INTG-103)',
    { tag: [Tag.regression] },
    async ({ ingestApi, integration }) => {
      const animora = await integration('animora');
      const gaos = await integration('gaos');

      await expectError(await ingestApi.send(gaos.ingestPath, buildGaosTask(), { token: animora.token }), 401);
      await expectError(
        await ingestApi.send(`/ingest/gaos/${animora.id}`, buildGaosTask(), { token: animora.token }),
        401,
      );
    },
  );

  test(
    'an unknown integration id is refused (401) (TC-INTG-104)',
    { tag: [Tag.regression] },
    async ({ ingestApi, integration }) => {
      const animora = await integration('animora');

      await expectError(
        await ingestApi.send('/ingest/animora/animora-000000', buildVideoRendered(), { token: animora.token }),
        401,
      );
    },
  );
});
