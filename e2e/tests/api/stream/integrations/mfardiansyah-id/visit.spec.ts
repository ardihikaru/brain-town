import { test, expect } from '@fixtures';
import { VisitRawSchema } from '@api/stream/integrations/mfardiansyah-id/site.schemas';
import {
  integrationEvents,
  seededNote,
  setupSite,
  SITE_AVAILABLE,
  SITE_SKIP_REASON,
  visitsSeen,
  waitForVisit,
} from '@api/stream/integrations/mfardiansyah-id/site.setup';
import { BROWSER_USER_AGENT, browserHeaders, visitorFor } from '@api/stream/integrations/mfardiansyah-id/visitor';
import { expectStatus } from '@api/core/assertions';
import { Tag } from '@utils/tags';

// Visits go through the "pull" site instance: the push integration's ingest budget (INGEST_RATE / INGEST_BURST, low in the
// e2e stack) is shared by every parallel worker, and a visit dropped with 429 is never retried by the site.
// A visit carries only page and country, so each worker is its own visitor (visitor.ts): IP 203.0.113.<slot>, country
// derived from the slot, mapped by the GeoIP file the stack writes. Tests of one worker run one after the other.

test.describe('mfardiansyah.id · visit beacon', () => {
  test.skip(!SITE_AVAILABLE, SITE_SKIP_REASON);

  test(
    'opening the home page sends one site.visit with page home and the visitor country (TC-INTG-030)',
    { tag: [Tag.smoke] },
    async ({ apiContextFor, sse, cleanup }) => {
      const { pull, ids } = await setupSite({ apiContextFor, cleanup });
      const visitor = visitorFor(test.info().parallelIndex);
      const stream = await sse.connect('admin');
      const note = await seededNote(pull);

      await expectStatus(await pull.home(browserHeaders(visitor)), 200);
      const event = await waitForVisit(stream, ids.pull, visitor.country, 'home');
      await expectStatus(await pull.blog(note.slug, browserHeaders(visitor)), 200);
      await waitForVisit(stream, ids.pull, visitor.country, 'blog');

      // The marker's visit is here, so a second home visit would be too (the hub delivers in order).
      expect(visitsSeen(stream, ids.pull, visitor.country, 'home')).toHaveLength(1);
      expect(VisitRawSchema.parse(event.raw).data).toEqual({ page: 'home', country: visitor.country });
    },
  );

  test(
    'opening a note sends one site.visit with page blog, the note title and the country (TC-INTG-031)',
    { tag: [Tag.smoke] },
    async ({ apiContextFor, sse, cleanup }) => {
      const { pull, ids } = await setupSite({ apiContextFor, cleanup });
      const visitor = visitorFor(test.info().parallelIndex);
      const stream = await sse.connect('admin');
      const note = await seededNote(pull);

      await expectStatus(await pull.blog(note.slug, browserHeaders(visitor)), 200);

      const event = await waitForVisit(stream, ids.pull, visitor.country, 'blog');
      expect(VisitRawSchema.parse(event.raw).data).toEqual({
        page: 'blog',
        country: visitor.country,
        title: note.title,
      });
    },
  );

  test(
    'the stored visit holds no IP address and no user agent (TC-INTG-032)',
    { tag: [Tag.regression] },
    async ({ apiContextFor, sse, cleanup }) => {
      const { pull, ids } = await setupSite({ apiContextFor, cleanup });
      const visitor = visitorFor(test.info().parallelIndex);
      const stream = await sse.connect('admin');
      const note = await seededNote(pull);

      await pull.blog(note.slug, browserHeaders(visitor));

      const event = await waitForVisit(stream, ids.pull, visitor.country, 'blog');
      // The strict schema allows only {id, type, at, data: {page, country, title?}}: nothing else can ride along.
      VisitRawSchema.parse(event.raw);
      const stored = JSON.stringify(event);
      expect(stored).not.toContain(visitor.ip);
      expect(stored).not.toContain(BROWSER_USER_AGENT);
    },
  );

  test(
    'a visitor without a known country sends nothing and Brain Town rejects nothing (TC-INTG-033)',
    { tag: [Tag.regression] },
    async ({ apiContextFor, adminApi, sse, cleanup }) => {
      const { pull, ids } = await setupSite({ apiContextFor, cleanup });
      const visitor = visitorFor(test.info().parallelIndex);
      const stream = await sse.connect('admin');
      const note = await seededNote(pull);

      // No X-Real-IP: the request comes from the docker gateway, a private address, so the GeoIP lookup has no country.
      await expectStatus(await pull.home({ 'user-agent': BROWSER_USER_AGENT }), 200);
      await pull.blog(note.slug, browserHeaders(visitor));

      // The marker visit (with a country) arrived; the site would have sent the country-less one before it. Brain Town
      // answers 422 to a visit without a two-letter country, so a wrongly sent one would be a rejected delivery.
      await waitForVisit(stream, ids.pull, visitor.country, 'blog');
      expect(await integrationEvents(adminApi, ids.pull, { delivery: 'rejected' })).toHaveLength(0);
    },
  );
});
