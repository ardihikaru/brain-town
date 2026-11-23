import { test, expect } from '@fixtures';
import { expectStatus } from '@api/core/assertions';
import { PublicEventSchema } from '@api/rest/admin/admin.schemas';
import { buildQaRun, buildQaRunFinished, buildQaRunStarted, buildQaStep } from '@data/factories/qa.factory';
import { uniqueId } from '@utils/unique';
import { Tag } from '@utils/tags';

// QA events carry the integration's current name as `tool`, looked up when the event is viewed.

test.describe('stream · qa tool name', () => {
  test(
    'public qa events carry the tool of the integration that sent them (TC-STR-060)',
    { tag: [Tag.smoke] },
    async ({ sse, ingestApi, integration }) => {
      const company = await integration('qa', { name: uniqueId('QA Company') });
      const personal = await integration('qa', { name: uniqueId('QA Personal') });
      const stream = await sse.connect('public');
      const companyRun = buildQaRun();
      const personalRun = buildQaRun();

      for (const [target, run] of [
        [company, companyRun],
        [personal, personalRun],
      ] as const) {
        const events = [buildQaRunStarted(run), buildQaStep(run, 0, 'Open page'), buildQaRunFinished(run, 1, 0)];
        for (const envelope of events) {
          await expectStatus(await ingestApi.send(target.ingestPath, envelope, { token: target.token }), 202);
        }
      }

      await stream.waitForJson(
        PublicEventSchema,
        (e) => e.type === 'qa.run.finished' && e.payload.run === personalRun.run,
      );
      const tools = (run: string) =>
        stream
          .jsonEvents(PublicEventSchema)
          .filter((e) => e.payload.run === run)
          .map((e) => e.tool);
      expect(tools(companyRun.run)).toEqual(Array(3).fill(company.integration.name));
      expect(tools(personalRun.run)).toEqual(Array(3).fill(personal.integration.name));
    },
  );

  test(
    'after a rename the next public qa event carries the new tool name (TC-STR-061)',
    { tag: [Tag.smoke] },
    async ({ sse, adminApi, ingestApi, integration }) => {
      const qa = await integration('qa', { name: uniqueId('QA Old') });
      const stream = await sse.connect('public');
      const first = buildQaRunStarted(buildQaRun());
      await expectStatus(await ingestApi.send(qa.ingestPath, first, { token: qa.token }), 202);
      const before = await stream.waitForJson(PublicEventSchema, (e) => e.id === first.id);
      const renamed = uniqueId('QA New');

      await expectStatus(await adminApi.updateIntegration(qa.id, { name: renamed }), 200);
      const second = buildQaRunStarted(buildQaRun());
      await expectStatus(await ingestApi.send(qa.ingestPath, second, { token: qa.token }), 202);

      const after = await stream.waitForJson(PublicEventSchema, (e) => e.id === second.id);
      expect(before.tool).toBe(qa.integration.name);
      expect(after.tool).toBe(renamed);
    },
  );
});
