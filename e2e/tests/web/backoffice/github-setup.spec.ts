import { test, expect } from '@fixtures';
import { expectJson } from '@api/core/assertions';
import { GithubAcceptedSchema, WEBHOOK_SECRET_PATTERN } from '@api/rest/github/github.schemas';
import { setupGithub } from '@api/rest/github/github.setup';
import { buildGithubScope, buildIssuesEvent, buildPing } from '@data/factories/github.factory';
import { uniqueId } from '@utils/unique';
import { Tag } from '@utils/tags';

// Arrange via API (a GitHub integration, optionally a ping), act in the setup page, assert in the page and via the API.

test.describe('backoffice · github setup', () => {
  test(
    'the secret is empty until Show, then it is a real whsec_ value the API accepts for signing (TC-BO-030)',
    { tag: [Tag.smoke] },
    async ({ backoffice, apiContextFor, adminApi, cleanup }) => {
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup });
      await backoffice.githubSetup.open(target.id);
      await expect(backoffice.githubSetup.secret).toHaveValue('');

      await backoffice.githubSetup.showSecret.click();

      await expect(backoffice.githubSetup.secret).toHaveValue(WEBHOOK_SECRET_PATTERN);
      await expect(backoffice.githubSetup.secret).not.toHaveValue(/•/);
      await expect(backoffice.githubSetup.secret).toHaveValue(target.secret);

      await test.step('the value shown signs a delivery the API accepts', async () => {
        const response = await github.send(
          target.ingestPath,
          'issues',
          buildIssuesEvent(buildGithubScope(), 'opened'),
          { secret: target.secret, delivery: uniqueId('delivery') },
        );
        await expectJson(response, GithubAcceptedSchema, 202);
      });
    },
  );

  test(
    'Copy puts the real secret on the clipboard without showing it first (TC-BO-031)',
    { tag: [Tag.smoke] },
    async ({ backoffice, context, apiContextFor, adminApi, cleanup }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup });
      await backoffice.githubSetup.open(target.id);

      await backoffice.githubSetup.copySecret.click();

      await expect
        .poll(() => backoffice.githubSetup.clipboardText(), { message: 'the clipboard holds the webhook secret' })
        .toMatch(WEBHOOK_SECRET_PATTERN);
      const copied = await backoffice.githubSetup.clipboardText();
      expect(copied).not.toContain('•');
      const response = await github.send(target.ingestPath, 'issues', buildIssuesEvent(buildGithubScope(), 'opened'), {
        secret: copied,
        delivery: uniqueId('delivery'),
      });
      await expectJson(response, GithubAcceptedSchema, 202);
    },
  );

  const details = [
    {
      event: 'issues',
      title: 'Issues',
      fig: 'person',
      sends: 'issue is opened',
      keeps: 'No body, no logins',
      town: 'org gate',
      group: 'Label changes within 15 s',
    },
    {
      event: 'pull_request',
      title: 'Pull requests',
      fig: 'scroll',
      sends: 'pull request is opened',
      keeps: 'No body, no diff',
      town: 'scroll is carried',
      group: 'Not grouped',
    },
    {
      event: 'issue_comment',
      title: 'Issue comments',
      fig: 'bubble',
      sends: 'new comment',
      keeps: 'never stored',
      town: 'speech bubble',
      group: 'ten comments',
    },
    {
      event: 'check_run',
      title: 'Check runs',
      fig: 'checks',
      sends: 'check finishes',
      keeps: 'check name',
      town: 'check pad',
      group: 'Not grouped',
    },
    {
      event: 'star',
      title: 'Stars',
      fig: 'stars',
      sends: 'stars a repo',
      keeps: 'Not who starred',
      town: 'Star lanterns',
      group: 'Stars on one repo',
    },
  ] as const;
  for (const row of details) {
    test(
      `the details of the ${row.title} chip say what GitHub sends, what is kept and what shows in town (TC-BO-032)`,
      { tag: [Tag.regression] },
      async ({ backoffice, apiContextFor, adminApi, cleanup }) => {
        const { target } = await setupGithub({ apiContextFor, adminApi, cleanup });
        await backoffice.githubSetup.open(target.id);

        await backoffice.githubSetup.openDetails(row.event);

        const page = backoffice.githubSetup;
        await expect(page.chip(row.event)).toHaveAttribute('aria-expanded', 'true');
        await expect(page.popoverTitle).toHaveText(row.title);
        await expect(page.popoverFigure).toHaveAttribute('data-fig', row.fig);
        await expect(page.popoverSends).toContainText(row.sends);
        await expect(page.popoverKeeps).toContainText(row.keeps);
        await expect(page.popoverTown).toContainText(row.town);
        await expect(page.popoverGroup).toContainText(row.group);
        await page.closeDetails();
        await expect(page.popover).toBeHidden();
        await expect(page.chip(row.event)).toHaveAttribute('aria-expanded', 'false');
      },
    );
  }

  test(
    'before any ping every chip is neutral and no warning shows (TC-BO-033)',
    { tag: [Tag.regression] },
    async ({ backoffice, apiContextFor, adminApi, cleanup }) => {
      const { target } = await setupGithub({ apiContextFor, adminApi, cleanup });

      await backoffice.githubSetup.open(target.id);

      await expect(backoffice.githubSetup.chip('issues')).toHaveAttribute('data-state', 'neutral');
      await expect(backoffice.githubSetup.chip('star')).toHaveAttribute('data-state', 'neutral');
      await expect(backoffice.githubSetup.missingCallout).toHaveCount(0);
    },
  );

  test(
    'a ping without Pull requests shows the missing-mandatory callout (TC-BO-034)',
    { tag: [Tag.smoke] },
    async ({ backoffice, apiContextFor, adminApi, cleanup }) => {
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup });
      await expectJson(
        await github.send(target.ingestPath, 'ping', buildPing(buildGithubScope(), ['issues', 'issue_comment']), {
          secret: target.secret,
          delivery: uniqueId('delivery'),
        }),
        GithubAcceptedSchema,
        202,
      );

      await backoffice.githubSetup.open(target.id);

      await expect(backoffice.githubSetup.missingCallout).toHaveAttribute('data-missing', 'pull_request');
      await expect(backoffice.githubSetup.missingCallout).toContainText('Pull requests');
      await expect(backoffice.githubSetup.chip('pull_request')).toHaveAttribute('data-state', 'missing');
      await expect(backoffice.githubSetup.chip('issues')).toHaveAttribute('data-state', 'subscribed');
    },
  );

  test(
    'after a complete ping the chips show subscribed, not needed and not ticked, and no warning (TC-BO-035)',
    { tag: [Tag.regression] },
    async ({ backoffice, apiContextFor, adminApi, cleanup }) => {
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup });
      const ticked = ['issues', 'pull_request', 'check_run', 'star'];
      await expectJson(
        await github.send(target.ingestPath, 'ping', buildPing(buildGithubScope(), ticked), {
          secret: target.secret,
          delivery: uniqueId('delivery'),
        }),
        GithubAcceptedSchema,
        202,
      );

      await backoffice.githubSetup.open(target.id);

      const page = backoffice.githubSetup;
      await expect(page.checklist).toHaveAttribute('data-events', ticked.join(','));
      for (const event of ticked) await expect(page.chip(event)).toHaveAttribute('data-state', 'subscribed');
      // Check runs satisfy the CI group, so the workflow options are "not needed"; optional events are "not ticked".
      await expect(page.chip('workflow_run')).toHaveAttribute('data-state', 'alt');
      await expect(page.chip('issue_comment')).toHaveAttribute('data-state', 'off');
      await expect(page.missingCallout).toHaveCount(0);
    },
  );

  test(
    'a ping that arrives while the page is open updates the chips live (TC-BO-036)',
    { tag: [Tag.smoke] },
    async ({ backoffice, apiContextFor, adminApi, cleanup }) => {
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup });
      await backoffice.githubSetup.open(target.id);
      await expect(backoffice.githubSetup.chip('issues')).toHaveAttribute('data-state', 'neutral');

      await expectJson(
        await github.send(target.ingestPath, 'ping', buildPing(buildGithubScope(), ['issues']), {
          secret: target.secret,
          delivery: uniqueId('delivery'),
        }),
        GithubAcceptedSchema,
        202,
      );

      await expect(backoffice.githubSetup.chip('issues')).toHaveAttribute('data-state', 'subscribed');
      await expect(backoffice.githubSetup.missingCallout).toHaveAttribute('data-missing', 'pull_request');
    },
  );
});
