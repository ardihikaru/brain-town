import { test, expect } from '@fixtures';
import { expectStatus } from '@api/core/assertions';
import { PublicEventSchema } from '@api/rest/admin/admin.schemas';
import { buildGaosTask } from '@data/factories/gaos.factory';
import { buildQaRunStarted } from '@data/factories/qa.factory';
import { buildArticle, buildSiteVisit } from '@data/factories/site.factory';
import { Tag } from '@utils/tags';

// Subscribe first, then trigger through the REST client, then assert the pushed payload (AGENTS.md §7.6).

test.describe('stream · /events', () => {
  test(
    'an accepted GAOS event is pushed as a named event with the public envelope (TC-STR-001)',
    {
      tag: [Tag.smoke],
    },
    async ({ sse, ingestApi, integration }) => {
      const gaos = await integration('gaos');
      const stream = await sse.connect('public');
      const envelope = buildGaosTask();

      await expectStatus(await ingestApi.send(gaos.ingestPath, envelope, { token: gaos.token }), 202);

      const pushed = await stream.waitFor((e) => PublicEventSchema.safeParse(e.json).data?.id === envelope.id);
      const body = PublicEventSchema.parse(pushed.json);
      expect(pushed.event).toBe('task.created');
      expect(pushed.id).toBe(String(body.seq));
      expect(body).toEqual({
        seq: body.seq,
        id: envelope.id,
        type: 'task.created',
        source: 'gaos',
        at: envelope.at.replace(/\.\d+Z$/, 'Z'),
        payload: envelope,
      });
    },
  );

  const kinds = [
    { kind: 'qa', build: buildQaRunStarted, type: 'qa.run.started' },
    { kind: 'site', build: () => buildArticle(), type: 'article.published' },
    { kind: 'site', build: () => buildSiteVisit(), type: 'site.visit' },
  ] as const;
  for (const { kind, build, type } of kinds) {
    test(
      `an accepted ${type} is pushed with source ${kind} (TC-STR-002)`,
      { tag: [Tag.regression] },
      async ({ sse, ingestApi, integration }) => {
        const target = await integration(kind);
        const stream = await sse.connect('public');
        const envelope = build();

        await expectStatus(await ingestApi.send(target.ingestPath, envelope, { token: target.token }), 202);

        const body = await stream.waitForJson(PublicEventSchema, (e) => e.id === envelope.id);
        expect(body).toMatchObject({ type, source: kind, payload: envelope });
      },
    );
  }

  test(
    'two subscribers both receive the same event (TC-STR-003)',
    { tag: [Tag.regression] },
    async ({ sse, ingestApi, integration }) => {
      const gaos = await integration('gaos');
      const first = await sse.connect('public');
      const second = await sse.connect('public');
      const envelope = buildGaosTask();

      await expectStatus(await ingestApi.send(gaos.ingestPath, envelope, { token: gaos.token }), 202);

      const [a, b] = await Promise.all([
        first.waitForJson(PublicEventSchema, (e) => e.id === envelope.id),
        second.waitForJson(PublicEventSchema, (e) => e.id === envelope.id),
      ]);
      expect(a).toEqual(b);
    },
  );
});
