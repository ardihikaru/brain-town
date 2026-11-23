import { test, expect } from '@fixtures';
import { expectStatus } from '@api/core/assertions';
import { buildQaRun, buildQaRunFinished, buildQaRunStarted, buildQaStep } from '@data/factories/qa.factory';
import { uniqueId } from '@utils/unique';
import { Tag } from '@utils/tags';

// Arrange via API (two named QA tools, one run each) → act in the QA Lab board → assert per tool group.
// Other tests share the town, so every assertion is scoped to this test's own tool names (data-tool).

test.describe('town · QA Lab board', () => {
  test(
    'the board groups runs under the name of the QA tool that ran them (TC-TOWN-030)',
    { tag: [Tag.smoke] },
    async ({ town, ingestApi, integration }) => {
      const company = await integration('qa', { name: uniqueId('QA Company') });
      const personal = await integration('qa', { name: uniqueId('QA Personal') });
      const companyRun = buildQaRun();
      const personalRun = buildQaRun();
      await town.home.goto();
      await expect(town.home.mode).toHaveText('live SSE');

      for (const [target, run] of [
        [company, companyRun],
        [personal, personalRun],
      ] as const) {
        const events = [buildQaRunStarted(run), buildQaStep(run, 0, 'Open page'), buildQaRunFinished(run, 1, 0)];
        for (const envelope of events) {
          await expectStatus(await ingestApi.send(target.ingestPath, envelope, { token: target.token }), 202);
        }
      }
      await expect(town.home.logLines.filter({ hasText: personalRun.spec })).not.toHaveCount(0);
      await town.home.openQaBoard();

      for (const [target, run] of [
        [company, companyRun],
        [personal, personalRun],
      ] as const) {
        const group = town.home.qaGroup(target.integration.name);
        await expect(group.getByRole('heading')).toContainText(target.integration.name);
        await expect(group.getByRole('heading')).toContainText('1 product');
        const card = town.home.qaCard(group, run.spec);
        await expect(card).toHaveCount(1);
        await expect(card.getByTestId('qa-tool-chip')).toHaveText(target.integration.name);
      }
    },
  );
});
