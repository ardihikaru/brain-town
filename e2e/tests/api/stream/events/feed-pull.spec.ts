import { test, expect } from '@fixtures';
import { expectError, expectJson } from '@api/core/assertions';
import { AdminEventListSchema, IntegrationSchema, PublicEventSchema } from '@api/rest/admin/admin.schemas';
import { buildFeedItem } from '@data/factories/feed.factory';
import { buildArticle } from '@data/factories/site.factory';
import { Tag } from '@utils/tags';

// The feed fixture serves JSON Feed files over https inside the compose network; the api trusts its throwaway CA
// through SSL_CERT_FILE (e2e/compose.e2e.yml) and pulls every FEED_PULL_INTERVAL_SECONDS (2 s in the e2e env).

test.describe('feed puller · site JSON Feed', () => {
  test(
    'new feed items become article.published events on /events (TC-FEED-001)',
    { tag: [Tag.smoke] },
    async ({ adminApi, sse, feed, integration }) => {
      const site = await integration('site');
      const items = [buildFeedItem(), buildFeedItem()];
      const feedUrl = await feed.publish(items);
      const stream = await sse.connect('public');

      await expectJson(await adminApi.updateIntegration(site.id, { feedUrl }), IntegrationSchema);

      for (const item of items) {
        const event = await stream.waitForJson(PublicEventSchema, (e) => e.id === item.id, 20_000);
        expect(event).toMatchObject({
          type: 'article.published',
          source: 'site',
          payload: { id: item.id, data: { title: item.title, url: item.url, to: 'blog' } },
        });
      }
    },
  );

  test(
    'a push with the id the feed already delivered is a duplicate (409) (TC-FEED-002)',
    {
      tag: [Tag.regression],
    },
    async ({ adminApi, sse, feed, ingestApi, integration }) => {
      const site = await integration('site');
      const item = buildFeedItem();
      const stream = await sse.connect('public');
      await expectJson(
        await adminApi.updateIntegration(site.id, { feedUrl: await feed.publish([item]) }),
        IntegrationSchema,
      );
      await stream.waitForJson(PublicEventSchema, (e) => e.id === item.id, 20_000);

      const push = buildArticle({ id: item.id, data: { title: item.title, url: item.url, to: 'blog' } });

      await expectError(await ingestApi.send(site.ingestPath, push, { token: site.token }), 409, 'id');
    },
  );

  test(
    'feed items without a title or a valid date are skipped (TC-FEED-003)',
    { tag: [Tag.regression] },
    async ({ adminApi, sse, feed, integration }) => {
      const site = await integration('site');
      const valid = buildFeedItem();
      const noTitle = buildFeedItem({ title: '' });
      const badDate = buildFeedItem({ date_published: 'yesterday' });
      const stream = await sse.connect('public');

      await expectJson(
        await adminApi.updateIntegration(site.id, { feedUrl: await feed.publish([noTitle, valid, badDate]) }),
        IntegrationSchema,
      );

      // One pull stores every usable item of the feed before it publishes, so once the valid item is on the stream
      // the skipped ones would already be in the log if they had been accepted.
      await stream.waitForJson(PublicEventSchema, (e) => e.id === valid.id, 20_000);
      const events = await expectJson(await adminApi.events({ integration: site.id }), AdminEventListSchema);
      expect(events.map((e) => e.id)).toEqual([valid.id]);
    },
  );
});
