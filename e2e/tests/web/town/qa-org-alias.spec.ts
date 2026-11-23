import { test, expect } from '@fixtures';
import { expectJson, expectStatus } from '@api/core/assertions';
import { OrgSchema } from '@api/rest/admin/admin.schemas';
import { buildQaRun, buildQaRunFinished, buildQaRunStarted, buildQaStep } from '@data/factories/qa.factory';
import { uniqueId } from '@utils/unique';
import { Tag } from '@utils/tags';

// Arrange via API (a QA tool whose org has a public alias, one run) → act in the QA Lab board → assert the card label.

test.describe('town · QA Lab org alias', () => {
  test(
    'the QA board shows the public org alias of a run, not the org key (TC-TOWN-040)',
    { tag: [Tag.smoke] },
    async ({ town, adminApi, ingestApi, integration, cleanup }) => {
      const org = uniqueId('org').toLowerCase();
      const alias = uniqueId('Town Name');
      const qa = await integration('qa', { name: uniqueId('QA Alias'), org });
      cleanup.add(() => adminApi.putOrg(org, { alias: '' }));
      await expectJson(await adminApi.putOrg(org, { alias }), OrgSchema);
      const run = buildQaRun({ org });
      await town.home.goto();
      await expect(town.home.mode).toHaveText('live SSE');

      for (const envelope of [
        buildQaRunStarted(run),
        buildQaStep(run, 0, 'Open page'),
        buildQaRunFinished(run, 1, 0),
      ]) {
        await expectStatus(await ingestApi.send(qa.ingestPath, envelope, { token: qa.token }), 202);
      }
      await expect(town.home.logLines.filter({ hasText: run.spec })).not.toHaveCount(0);
      await town.home.openQaBoard();

      const group = town.home.qaGroup(qa.integration.name);
      await expect(town.home.qaCard(group, run.spec)).toHaveCount(1);
      await expect(town.home.qaOrgLabel(group, alias)).toHaveCount(1);
      await expect(group).not.toContainText(org);
    },
  );
});
