import { test, expect } from '@fixtures';
import { expectJson } from '@api/core/assertions';
import { GithubAcceptedSchema } from '@api/rest/github/github.schemas';
import { setupGithub } from '@api/rest/github/github.setup';
import { buildGithubScope, buildIssue, buildIssueComment, buildIssuesEvent } from '@data/factories/github.factory';
import { uniqueId } from '@utils/unique';
import { Tag } from '@utils/tags';

// Arrange via API (a GitHub integration), open the town, then GitHub delivers and the "Live feed" shows it.

test.describe('town · github feed', () => {
  test(
    'an issue opened in a repo appears in the feed under the repo name (TC-TOWN-010)',
    { tag: [Tag.smoke] },
    async ({ town, apiContextFor, adminApi, cleanup }) => {
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup });
      await town.home.goto();
      await expect(town.home.mode).toHaveText('live SSE');
      const scope = buildGithubScope();
      const issue = buildIssue();

      await expectJson(
        await github.send(target.ingestPath, 'issues', buildIssuesEvent(scope, 'opened', issue), {
          secret: target.secret,
          delivery: uniqueId('delivery'),
        }),
        GithubAcceptedSchema,
        202,
      );

      const line = town.home.logLines.filter({ hasText: scope.repo });
      await expect(line).toContainText('issue.opened');
      await expect(line).toContainText(`#${issue.number}`);
    },
  );

  test(
    'an issue in a private repo shows as a private issue and neither title nor repo name reaches the page (TC-TOWN-011)',
    { tag: [Tag.smoke] },
    async ({ town, apiContextFor, adminApi, cleanup }) => {
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup });
      await town.home.goto();
      await expect(town.home.mode).toHaveText('live SSE');
      const scope = buildGithubScope({ private: true });
      const issue = buildIssue();

      await expectJson(
        await github.send(target.ingestPath, 'issues', buildIssuesEvent(scope, 'opened', issue), {
          secret: target.secret,
          delivery: uniqueId('delivery'),
        }),
        GithubAcceptedSchema,
        202,
      );

      await expect(town.home.logLines.filter({ hasText: `Private issue ${issue.number}` })).toContainText(
        'issue.opened',
      );
      await expect(town.home.log).not.toContainText(issue.title);
      await expect(town.home.log).not.toContainText(scope.repo);
    },
  );

  test(
    'five comments on an issue show as one feed line with the summed count (TC-TOWN-012)',
    { tag: [Tag.regression] },
    async ({ town, apiContextFor, adminApi, cleanup }) => {
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup });
      await town.home.goto();
      await expect(town.home.mode).toHaveText('live SSE');
      const scope = buildGithubScope();
      const issue = buildIssue();

      for (let i = 0; i < 5; i++) {
        await expectJson(
          await github.send(target.ingestPath, 'issue_comment', buildIssueComment(scope, issue), {
            secret: target.secret,
            delivery: uniqueId('delivery'),
          }),
          GithubAcceptedSchema,
          202,
        );
      }

      const line = town.home.logLines.filter({ hasText: scope.repo }).filter({ hasText: 'issue.commented' });
      // The server merges comments for 15 s before it publishes the one rollup event, so the line cannot
      // appear sooner: window (15 s) plus the one-second flush tick plus a margin.
      await expect(line).toContainText('+5 comments', { timeout: 25_000 });
      await expect(line).toHaveCount(1);
    },
  );
});
