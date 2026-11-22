import { test, expect } from '@fixtures';
import { expectStatus } from '@api/core/assertions';
import { AdminEventSchema, PublicEventSchema } from '@api/rest/admin/admin.schemas';
import { SseHttpError } from '@api/stream/events/events.client';
import { buildGaosTask } from '@data/factories/gaos.factory';
import { omit } from '@data/factories/mutate';
import { Tag } from '@utils/tags';

test.describe('stream · rejected deliveries', () => {
  test(
    'a rejected delivery shows on /admin/events and never on /events (TC-STR-020)',
    {
      tag: [Tag.smoke],
    },
    async ({ sse, ingestApi, integration }) => {
      const gaos = await integration('gaos');
      const publicStream = await sse.connect('public');
      const adminStream = await sse.connect('admin');
      const good = buildGaosTask();

      await test.step('send an invalid delivery, then a valid one', async () => {
        await expectStatus(
          await ingestApi.send(gaos.ingestPath, omit(buildGaosTask(), 'task.id'), { token: gaos.token }),
          422,
        );
        await expectStatus(await ingestApi.send(gaos.ingestPath, good, { token: gaos.token }), 202);
      });

      const rejected = await adminStream.waitForJson(
        AdminEventSchema,
        (e) => e.integration === gaos.id && e.delivery === 'rejected',
      );
      // The hub delivers in order: once the later valid event arrived on /events, the rejected one would have too.
      const accepted = await publicStream.waitForJson(PublicEventSchema, (e) => e.id === good.id);
      expect(rejected).toMatchObject({ status: 422, type: 'task.created' });
      expect(rejected.reason).toContain('task.id');
      expect(accepted.seq).toBeGreaterThan(rejected.seq);
      expect(publicStream.jsonEvents(PublicEventSchema).map((e) => e.seq)).not.toContain(rejected.seq);
    },
  );

  test('/admin/events without a session is refused (401) (TC-STR-021)', { tag: [Tag.regression] }, async ({ sse }) => {
    await expect(sse.connect('admin', { headers: { cookie: '' } })).rejects.toMatchObject({ status: 401 });
    await expect(sse.connect('admin', { headers: { cookie: 'bt_session=forged' } })).rejects.toBeInstanceOf(
      SseHttpError,
    );
  });
});
