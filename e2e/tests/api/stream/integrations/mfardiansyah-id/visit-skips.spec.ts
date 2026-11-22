import { test, expect } from '@fixtures';
import {
  seededNote,
  setupSite,
  SITE_AVAILABLE,
  SITE_SKIP_REASON,
  visitsSeen,
  waitForVisit,
} from '@api/stream/integrations/mfardiansyah-id/site.setup';
import { browserHeaders, visitorFor, type Visitor } from '@api/stream/integrations/mfardiansyah-id/visitor';
import { expectStatus } from '@api/core/assertions';
import { Tag } from '@utils/tags';

interface SkippedVisit {
  tc: string;
  name: string;
  headers: (visitor: Visitor) => Record<string, string>;
}

// Requests the site must not report: crawlers, browser prefetches and the owner's own admin session.
const skipped: SkippedVisit[] = [
  {
    tc: 'TC-INTG-034',
    name: 'a crawler',
    headers: (v) =>
      browserHeaders(v, { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' }),
  },
  { tc: 'TC-INTG-035', name: 'a browser prefetch', headers: (v) => browserHeaders(v, { 'sec-purpose': 'prefetch' }) },
  {
    tc: 'TC-INTG-036',
    name: 'the owner (admin session cookie)',
    headers: (v) => browserHeaders(v, { cookie: 'mfs_admin=e2e' }),
  },
];

test.describe('mfardiansyah.id · visits that are not reported', () => {
  test.skip(!SITE_AVAILABLE, SITE_SKIP_REASON);

  for (const row of skipped) {
    test(
      `${row.name} sends no site.visit (${row.tc})`,
      { tag: [Tag.regression] },
      async ({ apiContextFor, sse, cleanup }) => {
        const { pull, ids } = await setupSite({ apiContextFor, cleanup });
        const visitor = visitorFor(test.info().parallelIndex);
        const stream = await sse.connect('admin');
        const note = await seededNote(pull);

        await expectStatus(await pull.home(row.headers(visitor)), 200);
        await expectStatus(await pull.blog(note.slug, browserHeaders(visitor)), 200);

        // The marker is a normal visit of the same visitor. Once it is here, an earlier beacon of the skipped request
        // would be here too, so the marker is the only visit of this country: no home visit, exactly one blog visit.
        await waitForVisit(stream, ids.pull, visitor.country, 'blog');
        expect(visitsSeen(stream, ids.pull, visitor.country, 'home')).toHaveLength(0);
        expect(visitsSeen(stream, ids.pull, visitor.country, 'blog')).toHaveLength(1);
      },
    );
  }
});
