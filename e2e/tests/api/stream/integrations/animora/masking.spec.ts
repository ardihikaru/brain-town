import { test, expect } from '@fixtures';
import { expectJson, expectStatus } from '@api/core/assertions';
import { AdminEventSchema, OrgSchema, ProductSchema, PublicEventSchema } from '@api/rest/admin/admin.schemas';
import { AnimoraRawSchema } from '@api/stream/integrations/animora/animora.schemas';
import {
  buildChannelConnected,
  buildVideoParts,
  buildVideoPublished,
  buildVideoRendered,
} from '@data/factories/animora.factory';
import { skipUnlessDestructiveAllowed } from '@utils/guards';
import { Tag } from '@utils/tags';
import { uniqueId } from '@utils/unique';

// A hidden org or product replaces product and org by their aliases and removes title, url, channel and account from
// `data`; vendor, dueAt, publishedAt, language, duration, format and code stay (code is an opaque id used to follow one
// video across events). The unmasked record stays in the stored `raw`.

test.describe('animora · masking', () => {
  test(
    'a hidden org masks title, url and channel of a publication but keeps vendor and code (TC-INTG-110)',
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
      const parts = buildVideoParts({ vendor: 'tiktok' });
      const envelope = buildVideoPublished(parts);

      await expectStatus(await ingestApi.send(animora.ingestPath, envelope, { token: animora.token }), 202);

      const frame = await publicStream.waitForJson(PublicEventSchema, (e) => e.id === envelope.id);
      expect(frame.payload).toMatchObject({ org: alias });
      expect(frame.payload.product).not.toBe('animora');
      expect(frame.payload.data).toMatchObject({ vendor: 'tiktok', code: parts.code });
      expect(frame.payload.data).not.toHaveProperty('title');
      expect(frame.payload.data).not.toHaveProperty('url');
      expect(frame.payload.data).not.toHaveProperty('channel');
      const publicJson = JSON.stringify(frame);
      for (const hidden of [parts.title, parts.channel, String(envelope.data.url), org]) {
        expect(publicJson).not.toContain(hidden);
      }
      const delivery = await adminStream.waitForJson(AdminEventSchema, (e) => e.id === envelope.id);
      expect(AnimoraRawSchema.parse(delivery.raw)).toMatchObject({
        org,
        data: { title: parts.title, channel: parts.channel },
      });
    },
  );

  test(
    'a hidden org also masks the channel and account of a connected account (TC-INTG-111)',
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
      const parts = buildVideoParts({ vendor: 'instagram' });
      const envelope = buildChannelConnected(parts);

      await expectStatus(await ingestApi.send(animora.ingestPath, envelope, { token: animora.token }), 202);

      const frame = await publicStream.waitForJson(PublicEventSchema, (e) => e.id === envelope.id);
      expect(frame.payload.data).toEqual({ vendor: 'instagram' });
      expect(JSON.stringify(frame)).not.toContain(parts.channel);
      expect(JSON.stringify(frame)).not.toContain(String(envelope.data.account));
    },
  );

  test(
    'the hidden product "animora" shows only its alias and masks title, url and channel (TC-INTG-112)',
    { tag: [Tag.regression, Tag.destructive] },
    async ({ adminApi, ingestApi, integration, sse, cleanup }) => {
      skipUnlessDestructiveAllowed();
      const alias = uniqueId('Studio');
      const animora = await integration('animora');
      // The product exists once its first event is accepted; it is shared by every animora integration, so it is
      // restored to public right after the test (and the other specs only read fields that masking never removes).
      await expectStatus(await ingestApi.send(animora.ingestPath, buildVideoRendered(), { token: animora.token }), 202);
      cleanup.add(() => adminApi.putProduct('animora', { visibility: 'public' }));
      await expectJson(await adminApi.putProduct('animora', { visibility: 'hidden', alias }), ProductSchema);
      const publicStream = await sse.connect('public');
      const parts = buildVideoParts();
      const envelope = buildVideoPublished(parts);

      await expectStatus(await ingestApi.send(animora.ingestPath, envelope, { token: animora.token }), 202);

      const frame = await publicStream.waitForJson(PublicEventSchema, (e) => e.id === envelope.id);
      expect(frame.payload.product).toBe(alias);
      expect(frame.payload.data).toMatchObject({ vendor: 'youtube', code: parts.code });
      expect(frame.payload.data).not.toHaveProperty('title');
      expect(frame.payload.data).not.toHaveProperty('url');
      expect(frame.payload.data).not.toHaveProperty('channel');
      expect(JSON.stringify(frame)).not.toContain(parts.title);
    },
  );
});
