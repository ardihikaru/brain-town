import { test, expect } from '@fixtures';
import { expectJson, expectStatus } from '@api/core/assertions';
import { AdminEventSchema, IntegrationSchema, CreatedIntegrationSchema } from '@api/rest/admin/admin.schemas';
import { AnimoraFeedSchema, AnimoraRawSchema } from '@api/stream/integrations/animora/animora.schemas';
import {
  ANIMORA_AVAILABLE,
  ANIMORA_SKIP_REASON,
  deliveriesOf,
  senderResults,
  setupAnimora,
} from '@api/stream/integrations/animora/animora.setup';
import { Tag } from '@utils/tags';
import { uniqueId } from '@utils/unique';

// Both sides: the REAL Animora Go server (public /feed.json, throwaway database seeded with a public, a private and a
// nonaktif published video) and the REAL naskah-to-video sender (`python -m app.braintown send`), both started by
// scripts/stack.sh against the e2e Brain Town over https. The stack-owned integration is shared and read-only here.

const PULL_WAIT_MS = 20_000;

test.describe('animora · both sides (real server and real sender)', () => {
  test.skip(!ANIMORA_AVAILABLE, ANIMORA_SKIP_REASON);

  test(
    'the real sender delivered every envelope, twice (202 then 409) (TC-INTG-130)',
    { tag: [Tag.smoke] },
    async ({ apiContextFor }) => {
      const { seed } = await setupAnimora({ apiContextFor });

      const results = senderResults();

      expect(results).toHaveLength(seed.senderEvents.length * 2);
      expect(results.filter((r) => r.outcome !== 'delivered')).toEqual([]);
    },
  );

  test(
    'what the real sender pushed is stored once per id, from the allowlist only (TC-INTG-131)',
    { tag: [Tag.smoke] },
    async ({ apiContextFor, adminApi }) => {
      const { integrationId, seed } = await setupAnimora({ apiContextFor });

      const stored = await deliveriesOf(adminApi, integrationId, { delivery: 'ok' });

      for (const sent of seed.senderEvents) {
        const matches = stored.filter((e) => e.id === sent.id);
        expect(matches, sent.id).toHaveLength(1);
        expect(matches[0]).toMatchObject({ type: sent.type, kind: 'animora', public: { source: 'animora' } });
        const raw = AnimoraRawSchema.parse(matches[0]?.raw);
        expect(raw.data).toMatchObject({
          title: seed.videos.public.title,
          channel: seed.channel.title,
          code: seed.videos.public.code,
        });
      }
    },
  );

  test(
    "the real server's /feed.json is a JSON Feed 1.1 with the public video only (TC-INTG-132)",
    { tag: [Tag.smoke] },
    async ({ apiContextFor }) => {
      const { server, seed } = await setupAnimora({ apiContextFor });

      const feed = await expectJson(await server.feed(), AnimoraFeedSchema);

      const ids = feed.items.map((i) => i.id);
      expect(ids).toContain(seed.videos.public.feedId);
      expect(ids).not.toContain(seed.videos.private.feedId);
      expect(ids).not.toContain(seed.videos.nonaktif.feedId);
      const item = feed.items.find((i) => i.id === seed.videos.public.feedId);
      expect(item).toMatchObject({
        url: seed.videos.public.url,
        title: seed.videos.public.title,
        _animora: { vendor: 'youtube', channel: seed.channel.title, code: seed.videos.public.code },
      });
    },
  );

  test(
    'Brain Town pulled the real feed: the public video is recorded, private and nonaktif are not (TC-INTG-133)',
    { tag: [Tag.smoke] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const { seed } = await setupAnimora({ apiContextFor });
      // A pull-only witness (the sender never uses its token): every event on it came from the puller.
      const witness = await expectJson(
        await adminApi.createIntegration({ kind: 'animora', name: uniqueId('animora-witness') }),
        CreatedIntegrationSchema,
        201,
      );
      cleanup.add(() => adminApi.deleteIntegration(witness.integration.id));
      await expectJson(
        await adminApi.updateIntegration(witness.integration.id, { feedUrl: seed.feedUrl }),
        IntegrationSchema,
      );

      await expect
        .poll(
          async () =>
            (await deliveriesOf(adminApi, witness.integration.id, { type: 'video.published' })).map((e) => e.id),
          { message: 'the puller records the public video from the real feed', timeout: PULL_WAIT_MS },
        )
        .toContain(seed.videos.public.feedId);

      const pulled = await deliveriesOf(adminApi, witness.integration.id, { type: 'video.published' });
      expect(pulled.map((e) => e.id)).toEqual([seed.videos.public.feedId]);
      const delivery = AdminEventSchema.parse(pulled[0]);
      expect(AnimoraRawSchema.parse(delivery.raw).data).toEqual({
        vendor: 'youtube',
        channel: seed.channel.title,
        title: seed.videos.public.title,
        url: seed.videos.public.url,
        publishedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        code: seed.videos.public.code,
      });
    },
  );

  test(
    'the video the real sender pushed and the real feed carried is one event (TC-INTG-134)',
    { tag: [Tag.smoke] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const { integrationId, seed } = await setupAnimora({ apiContextFor });
      // The stack integration (sender token) pulls the real feed too. A pull-only witness proves a pull tick ran.
      const witness = await expectJson(
        await adminApi.createIntegration({ kind: 'animora', name: uniqueId('animora-witness') }),
        CreatedIntegrationSchema,
        201,
      );
      cleanup.add(() => adminApi.deleteIntegration(witness.integration.id));
      await expectJson(
        await adminApi.updateIntegration(witness.integration.id, { feedUrl: seed.feedUrl }),
        IntegrationSchema,
      );
      await expect
        .poll(async () => (await deliveriesOf(adminApi, witness.integration.id, { type: 'video.published' })).length, {
          message: 'a pull tick ran',
          timeout: PULL_WAIT_MS,
        })
        .toBeGreaterThan(0);

      const stored = await deliveriesOf(adminApi, integrationId, { type: 'video.published', delivery: 'ok' });

      expect(stored.filter((e) => e.id === seed.videos.public.feedId)).toHaveLength(1);
      expect(stored.map((e) => e.id)).not.toContain(seed.videos.private.feedId);
      expect(stored.map((e) => e.id)).not.toContain(seed.videos.nonaktif.feedId);
    },
  );

  test('the real server answers ready (TC-INTG-135)', { tag: [Tag.regression] }, async ({ apiContextFor }) => {
    const { server } = await setupAnimora({ apiContextFor });

    await expectStatus(await server.readyz(), 200);
  });
});
