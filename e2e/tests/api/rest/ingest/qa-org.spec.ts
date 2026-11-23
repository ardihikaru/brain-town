import { test, expect } from '@fixtures';
import { expectJson } from '@api/core/assertions';
import { AdminEventListSchema } from '@api/rest/admin/admin.schemas';
import { AcceptedSchema } from '@api/rest/ingest/ingest.schemas';
import { buildQaRun, buildQaRunStarted } from '@data/factories/qa.factory';
import { omit } from '@data/factories/mutate';
import { uniqueId } from '@utils/unique';
import { Tag } from '@utils/tags';

test.describe('ingest · qa org', () => {
  test(
    'a run sent without org is filed under the org of its integration (TC-ING-071)',
    { tag: [Tag.regression] },
    async ({ adminApi, ingestApi, integration }) => {
      const org = uniqueId('org').toLowerCase();
      const qa = await integration('qa', { org });
      const started = buildQaRunStarted(buildQaRun());

      await expectJson(
        await ingestApi.send(qa.ingestPath, omit(started, 'org'), { token: qa.token }),
        AcceptedSchema,
        202,
      );

      const [stored] = await expectJson(await adminApi.events({ integration: qa.id }), AdminEventListSchema);
      expect(stored).toMatchObject({ id: started.id, org, raw: { org }, public: { payload: { org } } });
    },
  );

  test(
    'a run sent with its own org keeps it (TC-ING-072)',
    { tag: [Tag.regression] },
    async ({ adminApi, ingestApi, integration }) => {
      const qa = await integration('qa', { org: uniqueId('org').toLowerCase() });
      const run = buildQaRun();

      await expectJson(
        await ingestApi.send(qa.ingestPath, buildQaRunStarted(run), { token: qa.token }),
        AcceptedSchema,
        202,
      );

      const [stored] = await expectJson(await adminApi.events({ integration: qa.id }), AdminEventListSchema);
      expect(stored).toMatchObject({ org: run.org, public: { payload: { org: run.org } } });
    },
  );
});
