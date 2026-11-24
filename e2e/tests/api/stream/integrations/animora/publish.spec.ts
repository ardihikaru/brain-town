import { test, expect } from '@fixtures';
import { expectJson, expectStatus } from '@api/core/assertions';
import { AdminEventSchema, ProductsSchema, PublicEventSchema } from '@api/rest/admin/admin.schemas';
import { AnimoraRawSchema } from '@api/stream/integrations/animora/animora.schemas';
import {
  buildChannelConnected,
  buildVideoParts,
  buildVideoPublishFailed,
  buildVideoPublished,
  buildVideoRendered,
  buildVideoScheduled,
  type AnimoraEnvelope,
  type Vendor,
} from '@data/factories/animora.factory';
import { Tag } from '@utils/tags';

// The contract tests push straight at the receiver (docs/integrations/animora.md). Assertions on the unmasked data read
// the stored `raw` on the admin stream; the public frame is checked only for fields that no masking ever removes
// (source, type, id, vendor, code), because the shared product `animora` can be hidden by the masking spec meanwhile.

interface TypeCase {
  tc: string;
  type: string;
  build: () => AnimoraEnvelope;
  tag: string;
}

const typeCases: TypeCase[] = [
  { tc: 'TC-INTG-070', type: 'video.rendered', build: () => buildVideoRendered(), tag: Tag.smoke },
  { tc: 'TC-INTG-071', type: 'video.scheduled', build: () => buildVideoScheduled(), tag: Tag.regression },
  { tc: 'TC-INTG-072', type: 'video.published', build: () => buildVideoPublished(), tag: Tag.smoke },
  { tc: 'TC-INTG-073', type: 'video.publish_failed', build: () => buildVideoPublishFailed(), tag: Tag.regression },
  { tc: 'TC-INTG-074', type: 'channel.connected', build: () => buildChannelConnected(), tag: Tag.regression },
];

test.describe('animora · push', () => {
  for (const { tc, type, build, tag } of typeCases) {
    test(
      `${type} is accepted (202) and reaches /events as source animora (${tc})`,
      { tag: [tag] },
      async ({ ingestApi, integration, sse }) => {
        const animora = await integration('animora');
        const publicStream = await sse.connect('public');
        const adminStream = await sse.connect('admin');
        const envelope = build();

        await expectStatus(await ingestApi.send(animora.ingestPath, envelope, { token: animora.token }), 202);

        const frame = await publicStream.waitForJson(PublicEventSchema, (e) => e.id === envelope.id);
        expect(frame).toMatchObject({ source: 'animora', type: envelope.type, id: envelope.id });
        const delivery = await adminStream.waitForJson(AdminEventSchema, (e) => e.id === envelope.id);
        const raw = AnimoraRawSchema.parse(delivery.raw);
        expect(raw).toEqual({
          id: envelope.id,
          type: envelope.type,
          at: envelope.at,
          product: '@animora-video',
          data: envelope.data,
        });
      },
    );
  }

  test(
    'an accepted event registers the public product "Animora" (TC-INTG-075)',
    { tag: [Tag.regression] },
    async ({ adminApi, ingestApi, integration }) => {
      const animora = await integration('animora');

      await expectStatus(await ingestApi.send(animora.ingestPath, buildVideoRendered(), { token: animora.token }), 202);

      const { products } = await expectJson(await adminApi.products(), ProductsSchema);
      const product = products.find((p) => p.key === '@animora-video');
      expect(product).toMatchObject({ name: 'Animora', hall: 'Video Studio hall' });
      expect(product?.sources).toContain('Animora');
    },
  );

  test(
    'keys outside the allowlist and prompt, script and failure text are dropped (TC-INTG-076)',
    { tag: [Tag.smoke] },
    async ({ ingestApi, integration, sse }) => {
      const animora = await integration('animora');
      const adminStream = await sse.connect('admin');
      const parts = buildVideoParts();
      const envelope = buildVideoRendered(parts, {
        data: {
          title: parts.title,
          channel: parts.channel,
          language: 'id',
          duration: 42,
          format: 'square',
          code: 'not a valid code!',
          prompt: `prompt ${parts.code}`,
          script: `script ${parts.code}`,
          failure: `failure ${parts.code}`,
          internal: { note: 'extra' },
        },
      });

      await expectStatus(await ingestApi.send(animora.ingestPath, envelope, { token: animora.token }), 202);

      const delivery = await adminStream.waitForJson(AdminEventSchema, (e) => e.id === envelope.id);
      const raw = AnimoraRawSchema.parse(delivery.raw);
      expect(raw.data).toEqual({ title: parts.title, channel: parts.channel, language: 'id', duration: 42 });
      const stored = JSON.stringify(delivery);
      for (const leaked of [`prompt ${parts.code}`, `script ${parts.code}`, `failure ${parts.code}`, 'extra']) {
        expect(stored).not.toContain(leaked);
      }
    },
  );

  test(
    'an account that looks like an email address is dropped (TC-INTG-077)',
    { tag: [Tag.regression] },
    async ({ ingestApi, integration, sse }) => {
      const animora = await integration('animora');
      const adminStream = await sse.connect('admin');
      const parts = buildVideoParts();
      const envelope = buildChannelConnected(parts, {
        data: { vendor: 'youtube', channel: parts.channel, account: 'someone@example.test' },
      });

      await expectStatus(await ingestApi.send(animora.ingestPath, envelope, { token: animora.token }), 202);

      const delivery = await adminStream.waitForJson(AdminEventSchema, (e) => e.id === envelope.id);
      expect(AnimoraRawSchema.parse(delivery.raw).data).toEqual({ vendor: 'youtube', channel: parts.channel });
      expect(JSON.stringify(delivery)).not.toContain('someone@example.test');
    },
  );

  test(
    'strings are trimmed and capped (title 200, channel 120, language 16) (TC-INTG-078)',
    { tag: [Tag.regression] },
    async ({ ingestApi, integration, sse }) => {
      const animora = await integration('animora');
      const adminStream = await sse.connect('admin');
      const envelope = buildVideoRendered(buildVideoParts(), {
        data: { title: `  ${'t'.repeat(300)}  `, channel: 'c'.repeat(200), language: 'l'.repeat(40) },
      });

      await expectStatus(await ingestApi.send(animora.ingestPath, envelope, { token: animora.token }), 202);

      const delivery = await adminStream.waitForJson(AdminEventSchema, (e) => e.id === envelope.id);
      expect(AnimoraRawSchema.parse(delivery.raw).data).toEqual({
        title: 't'.repeat(200),
        channel: 'c'.repeat(120),
        language: 'l'.repeat(16),
      });
    },
  );

  test(
    'an invalid video code is dropped without rejecting the event (TC-INTG-079)',
    { tag: [Tag.regression] },
    async ({ ingestApi, integration, sse }) => {
      const animora = await integration('animora');
      const adminStream = await sse.connect('admin');
      const parts = buildVideoParts();
      const envelope = buildVideoPublished(parts, {
        data: { ...buildVideoPublished(parts).data, code: 'x'.repeat(33) },
      });

      await expectStatus(await ingestApi.send(animora.ingestPath, envelope, { token: animora.token }), 202);

      const delivery = await adminStream.waitForJson(AdminEventSchema, (e) => e.id === envelope.id);
      expect(AnimoraRawSchema.parse(delivery.raw).data).not.toHaveProperty('code');
    },
  );

  const vendorCases: [Vendor, string][] = [
    ['youtube', 'TC-INTG-080'],
    ['facebook', 'TC-INTG-081'],
    ['instagram', 'TC-INTG-082'],
    ['tiktok', 'TC-INTG-083'],
  ];
  for (const [vendor, tc] of vendorCases) {
    test(
      `${vendor} publication keeps its vendor on the stored and the public event (${tc})`,
      { tag: [Tag.regression] },
      async ({ ingestApi, integration, sse }) => {
        const animora = await integration('animora');
        const publicStream = await sse.connect('public');
        const adminStream = await sse.connect('admin');
        const parts = buildVideoParts({ vendor });
        const envelope = buildVideoPublished(parts);

        await expectStatus(await ingestApi.send(animora.ingestPath, envelope, { token: animora.token }), 202);

        const frame = await publicStream.waitForJson(PublicEventSchema, (e) => e.id === envelope.id);
        expect(frame.payload.data).toMatchObject({ vendor, code: parts.code });
        const delivery = await adminStream.waitForJson(AdminEventSchema, (e) => e.id === envelope.id);
        expect(AnimoraRawSchema.parse(delivery.raw).data).toMatchObject({ vendor, code: parts.code });
      },
    );
  }
});
