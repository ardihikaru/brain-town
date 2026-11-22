import { test, expect } from '@fixtures';
import { expectError } from '@api/core/assertions';
import { env } from '@config/env';
import { buildGaosTask } from '@data/factories/gaos.factory';
import { Tag } from '@utils/tags';

// The e2e stack runs with a low INGEST_RATE / INGEST_BURST (env/.env.local), so this is a bounded burst of
// INGEST_BURST + 10 requests, not a load loop (AGENTS.md §6.2). Load is measured by k6 in perf/.

test.describe('ingest · rate limit', () => {
  test(
    'a burst above INGEST_BURST gets 429 with Retry-After: 1 (TC-ING-040)',
    { tag: [Tag.regression] },
    async ({ ingestApi, integration }) => {
      const gaos = await integration('gaos');
      const total = env.INGEST_BURST + 10;

      const started = Date.now();
      const responses = await Promise.all(
        Array.from({ length: total }, () => ingestApi.send(gaos.ingestPath, buildGaosTask(), { token: gaos.token })),
      );
      const elapsedSeconds = (Date.now() - started) / 1000;

      const statuses = responses.map((r) => r.status());
      const accepted = statuses.filter((s) => s === 202).length;
      const limited = responses.filter((r) => r.status() === 429);
      // The bucket refills at INGEST_RATE/s while the burst is in flight.
      const allowed = env.INGEST_BURST + Math.ceil(elapsedSeconds * env.INGEST_RATE);
      expect(
        statuses.every((s) => s === 202 || s === 429),
        `statuses: ${statuses.join(',')}`,
      ).toBe(true);
      expect(accepted).toBeGreaterThanOrEqual(env.INGEST_BURST);
      expect(accepted).toBeLessThanOrEqual(allowed);
      expect(limited).toHaveLength(total - accepted);
      expect(limited.length).toBeGreaterThan(0);
      for (const response of limited) {
        expect(response.headers()['retry-after']).toBe('1');
        await expectError(response, 429);
      }
    },
  );

  test(
    'a limited integration is accepted again once the bucket refills (TC-ING-041)',
    {
      tag: [Tag.regression],
    },
    async ({ ingestApi, integration }) => {
      const gaos = await integration('gaos');
      await Promise.all(
        Array.from({ length: env.INGEST_BURST + 5 }, () =>
          ingestApi.send(gaos.ingestPath, buildGaosTask(), { token: gaos.token }),
        ),
      );

      await expect
        .poll(async () => (await ingestApi.send(gaos.ingestPath, buildGaosTask(), { token: gaos.token })).status(), {
          message: 'ingest should accept again after the bucket refills',
          intervals: [250],
          timeout: 5_000,
        })
        .toBe(202);
    },
  );
});
