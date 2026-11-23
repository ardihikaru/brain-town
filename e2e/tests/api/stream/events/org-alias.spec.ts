import { test, expect } from '@fixtures';
import { expectJson, expectStatus } from '@api/core/assertions';
import { OrgSchema, PublicEventSchema } from '@api/rest/admin/admin.schemas';
import { buildQaRun, buildQaRunStarted, buildQaStep } from '@data/factories/qa.factory';
import { uniqueId } from '@utils/unique';
import { Tag } from '@utils/tags';

// A public org with a custom alias shows the alias on /events: payload.org, whole-token key mentions in data
// strings, and no url that contains the key. payload.product is not touched.

test.describe('stream · org alias on the public stream', () => {
  test(
    'a public org with an alias shows the alias, never its key, on /events (TC-STR-070)',
    { tag: [Tag.smoke] },
    async ({ sse, adminApi, ingestApi, integration, cleanup }) => {
      const org = uniqueId('org').toLowerCase();
      const alias = uniqueId('Town Name');
      const qa = await integration('qa', { org });
      cleanup.add(() => adminApi.putOrg(org, { alias: '' }));
      await expectJson(await adminApi.putOrg(org, { alias }), OrgSchema);
      const run = buildQaRun({ org });
      const stream = await sse.connect('public');
      const started = buildQaRunStarted(run);
      const named = buildQaStep(run, 0, `Open ${org} page`);
      const linked = {
        ...buildQaStep(run, 1, 'Check link'),
        data: { index: 1, step: 'Check link', url: `https://qa.example/${org}/x` },
      };

      for (const envelope of [started, named, linked]) {
        await expectStatus(await ingestApi.send(qa.ingestPath, envelope, { token: qa.token }), 202);
      }

      const publicEvent = (id: string) => stream.waitForJson(PublicEventSchema, (e) => e.id === id);
      const startedEvent = await publicEvent(started.id);
      const namedEvent = await publicEvent(named.id);
      const linkedEvent = await publicEvent(linked.id);
      expect(startedEvent.payload.org).toBe(alias);
      expect(startedEvent.payload.product).toBe(run.product);
      expect(namedEvent.payload.org).toBe(alias);
      expect(JSON.stringify(namedEvent.payload.data)).toContain(`Open ${alias} page`);
      expect((linkedEvent.payload.data as Record<string, unknown>).url).toBeUndefined();
      for (const event of [startedEvent, namedEvent, linkedEvent]) {
        expect(JSON.stringify(event)).not.toContain(org);
      }
    },
  );
});
