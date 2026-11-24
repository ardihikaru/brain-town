import { test, expect } from '@fixtures';
import { expectJson, expectStatus } from '@api/core/assertions';
import { AdminEventSchema, IntegrationSchema, OrgSchema, PublicEventSchema } from '@api/rest/admin/admin.schemas';
import { AnimoraRawSchema } from '@api/stream/integrations/animora/animora.schemas';
import {
  buildAnimoraFeedItem,
  buildChannelConnected,
  buildVideoParts,
  buildVideoPublishFailed,
  buildVideoPublished,
  buildVideoRenderFailed,
  buildVideoRendered,
  buildVideoScheduled,
  buildVideoStarted,
  type AnimoraEnvelope,
} from '@data/factories/animora.factory';
import { skipUnlessDestructiveAllowed } from '@utils/guards';
import { Tag } from '@utils/tags';
import { uniqueId } from '@utils/unique';

// `data.concept` is the optional public series name on every video.* type (docs/integrations/animora.md). It is read
// from the stored `raw` on the admin stream, which masking never touches: the public product `animora` is flipped by
// the masking spec meanwhile, so a public frame is only checked where the org of this test is hidden.

const PULL_WAIT_MS = 20_000;

interface ConceptCase {
  type: string;
  build: (concept: string) => AnimoraEnvelope;
}

const conceptCases: ConceptCase[] = [
  { type: 'video.started', build: (concept) => withConcept(buildVideoStarted(), concept) },
  { type: 'video.rendered', build: (concept) => withConcept(buildVideoRendered(), concept) },
  { type: 'video.render_failed', build: (concept) => withConcept(buildVideoRenderFailed(), concept) },
  { type: 'video.scheduled', build: (concept) => withConcept(buildVideoScheduled(), concept) },
  { type: 'video.published', build: (concept) => withConcept(buildVideoPublished(), concept) },
  { type: 'video.publish_failed', build: (concept) => withConcept(buildVideoPublishFailed(), concept) },
];

function withConcept(envelope: AnimoraEnvelope, concept: string): AnimoraEnvelope {
  return { ...envelope, data: { ...envelope.data, concept } };
}

test.describe('animora · concept', () => {
  for (const { type, build } of conceptCases) {
    test(
      `${type} keeps data.concept (TC-INTG-150)`,
      { tag: [Tag.regression] },
      async ({ ingestApi, integration, sse }) => {
        const animora = await integration('animora');
        const adminStream = await sse.connect('admin');
        const concept = uniqueId('Seri');
        const envelope = build(concept);

        await expectStatus(await ingestApi.send(animora.ingestPath, envelope, { token: animora.token }), 202);

        const delivery = await adminStream.waitForJson(AdminEventSchema, (e) => e.id === envelope.id);
        expect(AnimoraRawSchema.parse(delivery.raw).data).toMatchObject({ concept });
      },
    );
  }

  test(
    'concept is trimmed and cut to 120 characters (runes, not bytes) (TC-INTG-151)',
    { tag: [Tag.regression] },
    async ({ ingestApi, integration, sse }) => {
      const animora = await integration('animora');
      const adminStream = await sse.connect('admin');
      const envelope = withConcept(buildVideoPublished(), `  Seri ${'漢'.repeat(140)}  `);

      await expectStatus(await ingestApi.send(animora.ingestPath, envelope, { token: animora.token }), 202);

      const delivery = await adminStream.waitForJson(AdminEventSchema, (e) => e.id === envelope.id);
      const stored = String(AnimoraRawSchema.parse(delivery.raw).data.concept);
      expect([...stored]).toHaveLength(120);
      expect(stored.startsWith('Seri 漢')).toBe(true);
    },
  );

  test(
    'a blank concept is dropped and the event is still accepted (TC-INTG-152)',
    { tag: [Tag.regression] },
    async ({ ingestApi, integration, sse }) => {
      const animora = await integration('animora');
      const adminStream = await sse.connect('admin');
      const envelope = withConcept(buildVideoPublished(), '   ');

      await expectStatus(await ingestApi.send(animora.ingestPath, envelope, { token: animora.token }), 202);

      const delivery = await adminStream.waitForJson(AdminEventSchema, (e) => e.id === envelope.id);
      expect(AnimoraRawSchema.parse(delivery.raw).data).not.toHaveProperty('concept');
    },
  );

  test(
    'channel.connected never carries a concept (TC-INTG-153)',
    { tag: [Tag.regression] },
    async ({ ingestApi, integration, sse }) => {
      const animora = await integration('animora');
      const adminStream = await sse.connect('admin');
      const envelope = withConcept(buildChannelConnected(), uniqueId('Seri'));

      await expectStatus(await ingestApi.send(animora.ingestPath, envelope, { token: animora.token }), 202);

      const delivery = await adminStream.waitForJson(AdminEventSchema, (e) => e.id === envelope.id);
      expect(AnimoraRawSchema.parse(delivery.raw).data).not.toHaveProperty('concept');
    },
  );

  test(
    'a hidden org drops the concept from the public event but the stored raw keeps it (TC-INTG-154)',
    { tag: [Tag.regression, Tag.destructive] },
    async ({ adminApi, ingestApi, integration, sse, cleanup }) => {
      skipUnlessDestructiveAllowed();
      const org = uniqueId('org');
      const alias = uniqueId('Studio');
      const animora = await integration('animora', { org });
      await expectStatus(await ingestApi.send(animora.ingestPath, buildVideoRendered(), { token: animora.token }), 202);
      cleanup.add(() => adminApi.putOrg(org, { visibility: 'public' }));
      await expectJson(await adminApi.putOrg(org, { visibility: 'hidden', alias }), OrgSchema);
      const publicStream = await sse.connect('public');
      const adminStream = await sse.connect('admin');
      const concept = uniqueId('Seri');
      const envelope = withConcept(buildVideoPublished(), concept);

      await expectStatus(await ingestApi.send(animora.ingestPath, envelope, { token: animora.token }), 202);

      const frame = await publicStream.waitForJson(PublicEventSchema, (e) => e.id === envelope.id);
      expect(frame.payload.data).not.toHaveProperty('concept');
      expect(JSON.stringify(frame)).not.toContain(concept);
      const delivery = await adminStream.waitForJson(AdminEventSchema, (e) => e.id === envelope.id);
      expect(AnimoraRawSchema.parse(delivery.raw).data).toMatchObject({ concept });
    },
  );

  test(
    'a feed item with _animora.concept is pulled as data.concept (TC-INTG-155)',
    { tag: [Tag.regression] },
    async ({ adminApi, feed, integration, sse }) => {
      const animora = await integration('animora');
      const stream = await sse.connect('admin');
      const parts = buildVideoParts();
      const concept = uniqueId('Seri');
      const base = buildAnimoraFeedItem(parts);
      const item = { ...base, _animora: { ...base._animora, concept } };
      const feedUrl = await feed.publish([item]);

      await expectJson(await adminApi.updateIntegration(animora.id, { feedUrl }), IntegrationSchema);

      const delivery = await stream.waitForJson(
        AdminEventSchema,
        (e) => e.integration === animora.id && e.id === item.id,
        PULL_WAIT_MS,
      );
      expect(AnimoraRawSchema.parse(delivery.raw).data).toMatchObject({ concept, code: parts.code });
    },
  );
});
