import { test, expect } from '@fixtures';
import { expectJson, expectStatus } from '@api/core/assertions';
import { AdminEventSchema, IntegrationSchema } from '@api/rest/admin/admin.schemas';
import { AnimoraRawSchema } from '@api/stream/integrations/animora/animora.schemas';
import type { SseConnection } from '@api/stream/events/events.client';
import { deliveriesOf } from '@api/stream/integrations/animora/animora.setup';
import {
  buildAnimoraFeedItem,
  buildVideoParts,
  buildVideoPublished,
  secondsAgo,
} from '@data/factories/animora.factory';
import { Tag } from '@utils/tags';

// The puller runs every few seconds in the e2e stack (FEED_PULL_INTERVAL_SECONDS); a per-wait timeout of 20 s above the
// 10 s default covers one tick plus the https fetch, like the mfardiansyah.id feed spec.
const PULL_WAIT_MS = 20_000;

test.describe('animora · feed pull (https fixture feed)', () => {
  test(
    'an animora integration with a feedUrl records video.published with the _animora data (TC-INTG-120)',
    { tag: [Tag.smoke] },
    async ({ adminApi, feed, integration, sse }) => {
      const animora = await integration('animora');
      const stream = await sse.connect('admin');
      const parts = buildVideoParts({ vendor: 'tiktok' });
      const item = buildAnimoraFeedItem(parts);
      const feedUrl = await feed.publish([item]);

      await expectJson(await adminApi.updateIntegration(animora.id, { feedUrl }), IntegrationSchema);

      const delivery = await stream.waitForJson(
        AdminEventSchema,
        (e) => e.integration === animora.id && e.id === item.id,
        PULL_WAIT_MS,
      );
      expect(delivery).toMatchObject({ type: 'video.published', delivery: 'ok', kind: 'animora' });
      expect(AnimoraRawSchema.parse(delivery.raw)).toEqual({
        id: item.id,
        type: 'video.published',
        at: item.date_published,
        product: '@animora-video',
        data: {
          vendor: 'tiktok',
          channel: parts.channel,
          title: parts.title,
          url: item.url,
          publishedAt: item.date_published,
          code: parts.code,
        },
      });
    },
  );

  test(
    'feed items without a valid _animora.vendor are skipped (TC-INTG-121)',
    { tag: [Tag.regression] },
    async ({ adminApi, feed, integration, sse }) => {
      const animora = await integration('animora');
      const stream = await sse.connect('admin');
      const parts = buildVideoParts();
      // The puller records oldest first, so the valid item is the newest: it is recorded last, after the others were decided.
      const older = secondsAgo(120);
      const noVendor = buildAnimoraFeedItem(parts, {
        date_published: older,
        _animora: { vendor: '', channel: parts.channel, code: parts.code },
      });
      const badVendor = buildAnimoraFeedItem(parts, {
        date_published: older,
        _animora: { vendor: 'myspace', channel: parts.channel, code: parts.code },
      });
      const good = buildAnimoraFeedItem(parts);
      const feedUrl = await feed.publish([noVendor, badVendor, good]);

      await expectJson(await adminApi.updateIntegration(animora.id, { feedUrl }), IntegrationSchema);

      await awaitPullOf(stream, animora.id, good.id);
      const stored = await deliveriesOf(adminApi, animora.id, { type: 'video.published' });
      expect(stored.map((e) => e.id)).toEqual([good.id]);
    },
  );

  test(
    'an item that was already pushed with the same id is not recorded again (TC-INTG-122)',
    { tag: [Tag.smoke] },
    async ({ adminApi, feed, ingestApi, integration, sse }) => {
      const animora = await integration('animora');
      const stream = await sse.connect('admin');
      const parts = buildVideoParts();
      const pushed = buildVideoPublished(parts);
      await expectStatus(await ingestApi.send(animora.ingestPath, pushed, { token: animora.token }), 202);
      const dup = buildAnimoraFeedItem(parts, {
        id: pushed.id,
        title: `${parts.title} (from the feed)`,
        date_published: secondsAgo(120),
      });
      const marker = buildAnimoraFeedItem(buildVideoParts());
      const feedUrl = await feed.publish([dup, marker]);

      await expectJson(await adminApi.updateIntegration(animora.id, { feedUrl }), IntegrationSchema);

      // The marker is newer than the duplicate, so it is recorded after the duplicate was decided (oldest first).
      await awaitPullOf(stream, animora.id, marker.id);
      const stored = await deliveriesOf(adminApi, animora.id, { type: 'video.published', delivery: 'ok' });
      const ofPushed = stored.filter((e) => e.id === pushed.id);
      expect(ofPushed).toHaveLength(1);
      expect(AnimoraRawSchema.parse(ofPushed[0]?.raw).data).toMatchObject({ title: parts.title });
    },
  );
});

function awaitPullOf(stream: SseConnection, integration: string, id: string) {
  return stream.waitForJson(AdminEventSchema, (e) => e.integration === integration && e.id === id, PULL_WAIT_MS);
}
