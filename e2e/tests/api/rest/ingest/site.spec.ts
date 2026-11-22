import { test, expect } from '@fixtures';
import { expectError, expectJson } from '@api/core/assertions';
import { AdminEventListSchema } from '@api/rest/admin/admin.schemas';
import { AcceptedSchema } from '@api/rest/ingest/ingest.schemas';
import { buildArticle, buildSiteVisit } from '@data/factories/site.factory';
import { omit, withValue } from '@data/factories/mutate';
import { Tag } from '@utils/tags';

test.describe('ingest · site', () => {
  test(
    'a published article is accepted (202) (TC-ING-020)',
    { tag: [Tag.smoke] },
    async ({ ingestApi, integration }) => {
      const site = await integration('site');

      await expectJson(
        await ingestApi.send(site.ingestPath, buildArticle(), { token: site.token }),
        AcceptedSchema,
        202,
      );
    },
  );

  test(
    'a published illustration is accepted (202) (TC-ING-020)',
    { tag: [Tag.regression] },
    async ({ ingestApi, integration }) => {
      const site = await integration('site');

      await expectJson(
        await ingestApi.send(site.ingestPath, buildArticle({ type: 'illustration.published' }), { token: site.token }),
        AcceptedSchema,
        202,
      );
    },
  );

  test(
    'site.visit is stored with page, country and title only (TC-ING-021)',
    { tag: [Tag.smoke] },
    async ({ adminApi, ingestApi, integration }) => {
      const site = await integration('site');
      const visit = buildSiteVisit();
      const leaky = {
        ...visit,
        ip: '203.0.113.7',
        userAgent: 'Mozilla/5.0',
        data: { ...visit.data, ip: '203.0.113.7', cookie: 'sid=1', city: 'Tokyo' },
      };

      await expectJson(await ingestApi.send(site.ingestPath, leaky, { token: site.token }), AcceptedSchema, 202);

      const [stored] = await expectJson(await adminApi.events({ integration: site.id }), AdminEventListSchema);
      expect(stored?.raw).toEqual({ id: visit.id, type: 'site.visit', at: visit.at, data: visit.data });
      expect(stored?.public.payload).toEqual({ id: visit.id, type: 'site.visit', at: visit.at, data: visit.data });
    },
  );

  const invalid: { title: string; field: string; body: () => object }[] = [
    { title: 'an article without a title', field: 'data', body: () => omit(buildArticle(), 'data.title') },
    { title: 'an article without a url', field: 'data', body: () => omit(buildArticle(), 'data.url') },
    { title: 'a GAOS type', field: 'type', body: () => withValue(buildArticle(), 'type', 'task.done') },
    {
      title: 'a visit to a page other than home/blog',
      field: 'data.page',
      body: () => buildSiteVisit({ page: 'about' }),
    },
    { title: 'a lower-case country', field: 'data.country', body: () => buildSiteVisit({ country: 'jp' }) },
    { title: 'a three-letter country', field: 'data.country', body: () => buildSiteVisit({ country: 'JPN' }) },
    { title: 'no country', field: 'data.country', body: () => omit(buildSiteVisit(), 'data.country') },
  ];
  for (const { title, field, body } of invalid) {
    test(
      `${title} is refused (422, field ${field}) (TC-ING-022)`,
      { tag: [Tag.regression] },
      async ({ ingestApi, integration }) => {
        const site = await integration('site');

        await expectError(await ingestApi.send(site.ingestPath, body(), { token: site.token }), 422, field);
      },
    );
  }
});
