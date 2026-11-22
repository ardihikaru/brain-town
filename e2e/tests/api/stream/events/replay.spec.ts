import { test, expect } from '@fixtures';
import { expectStatus } from '@api/core/assertions';
import { PublicEventSchema } from '@api/rest/admin/admin.schemas';
import { buildGaosTask } from '@data/factories/gaos.factory';
import { Tag } from '@utils/tags';

test.describe('stream · reconnect', () => {
  test(
    'Last-Event-ID replays the events missed while disconnected, in order (TC-STR-030)',
    {
      tag: [Tag.smoke],
    },
    async ({ sse, ingestApi, integration }) => {
      const gaos = await integration('gaos');
      const first = buildGaosTask();
      const missed = [buildGaosTask(), buildGaosTask()];

      const lastSeen = await test.step('receive one event, then disconnect', async () => {
        const stream = await sse.connect('public');
        await expectStatus(await ingestApi.send(gaos.ingestPath, first, { token: gaos.token }), 202);
        const event = await stream.waitFor((e) => PublicEventSchema.safeParse(e.json).data?.id === first.id);
        stream.close();
        return event.id;
      });

      await test.step('events arrive while nobody listens', async () => {
        for (const envelope of missed) {
          await expectStatus(await ingestApi.send(gaos.ingestPath, envelope, { token: gaos.token }), 202);
        }
      });

      const replayed = await sse.connect('public', { lastEventId: lastSeen });
      const got = await Promise.all(missed.map((m) => replayed.waitForJson(PublicEventSchema, (e) => e.id === m.id)));
      expect(got.map((e) => e.id)).toEqual(missed.map((m) => m.id));
      expect(got.every((e) => e.seq > Number(lastSeen))).toBe(true);
      expect(replayed.jsonEvents(PublicEventSchema).map((e) => e.id)).not.toContain(first.id);
    },
  );
});
