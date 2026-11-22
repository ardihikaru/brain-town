import { test, expect } from '@fixtures';
import { expectJson } from '@api/core/assertions';
import { IntegrationListSchema } from '@api/rest/admin/admin.schemas';
import { GithubAcceptedSchema, RevealedSecretSchema } from '@api/rest/github/github.schemas';
import { setupGithub } from '@api/rest/github/github.setup';
import type { GithubClient } from '@api/rest/github/github.client';
import { buildRepoPing, type GithubScope } from '@data/factories/github.factory';
import { uniqueId } from '@utils/unique';
import { Tag } from '@utils/tags';

// Arrange via API (an owner with pinged repos), act in the integrations list and the owner page, assert in the page and via the API.

function repoScope(login: string, options: { private?: boolean } = {}): GithubScope {
  return { org: login, repo: uniqueId('repo'), private: options.private ?? false, ownerType: 'user' };
}

async function ping(
  github: GithubClient,
  target: { ingestPath: string; secret: string },
  scope: GithubScope,
  events: string[],
) {
  const response = await github.send(target.ingestPath, 'ping', buildRepoPing(scope, events), {
    secret: target.secret,
    delivery: uniqueId('delivery'),
  });
  await expectJson(response, GithubAcceptedSchema, 202);
}

test.describe('backoffice · github owners', () => {
  test(
    'the card of a personal owner says Personal and counts its 2 pinged repos (TC-BO-040)',
    { tag: [Tag.smoke] },
    async ({ backoffice, apiContextFor, adminApi, cleanup }) => {
      const login = uniqueId('me');
      const { github, target } = await setupGithub(
        { apiContextFor, adminApi, cleanup },
        { org: login, ownerType: 'user' },
      );
      await ping(github, target, repoScope(login), ['issues', 'pull_request']);
      await ping(github, target, repoScope(login), ['issues', 'pull_request']);

      await backoffice.integrations.goto();

      await expect(backoffice.integrations.ownerCard(target.id)).toBeVisible();
      await expect(backoffice.integrations.ownerType(target.id)).toHaveText('Personal');
      await expect(backoffice.integrations.ownerType(target.id)).toHaveAttribute('data-owner-type', 'user');
      await expect(backoffice.integrations.ownerRepos(target.id)).toHaveText('2 repos');
    },
  );

  test(
    'the card of an organization owner says Organization and No repos yet (TC-BO-041)',
    { tag: [Tag.regression] },
    async ({ backoffice, apiContextFor, adminApi, cleanup }) => {
      const { target } = await setupGithub(
        { apiContextFor, adminApi, cleanup },
        { org: uniqueId('acme'), ownerType: 'organization' },
      );

      await backoffice.integrations.goto();

      await expect(backoffice.integrations.ownerType(target.id)).toHaveText('Organization');
      await expect(backoffice.integrations.ownerType(target.id)).toHaveAttribute('data-owner-type', 'organization');
      await expect(backoffice.integrations.ownerRepos(target.id)).toHaveText('No repos yet');
    },
  );

  test(
    'the card of an owner without a type says Owner type not set and opens its owner page (TC-BO-042)',
    { tag: [Tag.regression] },
    async ({ backoffice, page, apiContextFor, adminApi, cleanup }) => {
      const { target } = await setupGithub({ apiContextFor, adminApi, cleanup });

      await backoffice.integrations.goto();

      await expect(backoffice.integrations.ownerType(target.id)).toHaveText('Owner type not set');
      await expect(backoffice.integrations.ownerType(target.id)).toHaveAttribute('data-owner-type', 'unknown');
      await backoffice.integrations.ownerOpen(target.id).click();
      await expect(page).toHaveURL(new RegExp(`#integration-${target.id}$`));
      await backoffice.owner.expectLoaded();
      await expect(backoffice.owner.root).toHaveAttribute('data-owner-id', target.id);
    },
  );

  test(
    'a custom alias typed for a hidden repo is saved, and clearing it resets it to Product X (TC-BO-043)',
    { tag: [Tag.smoke] },
    async ({ backoffice, apiContextFor, adminApi, cleanup }) => {
      const login = uniqueId('me');
      const scope = repoScope(login, { private: true });
      const { github, target } = await setupGithub(
        { apiContextFor, adminApi, cleanup },
        { org: login, ownerType: 'user' },
      );
      await ping(github, target, scope, ['issues', 'pull_request']);
      const alias = uniqueId('Vault');
      await backoffice.owner.open(target.id);
      const repoRow = async () =>
        (await expectJson(await adminApi.listIntegrations(), IntegrationListSchema)).find((i) => i.id === target.id)
          ?.repos[0];

      await backoffice.owner.setAlias(scope.repo, alias);

      await expect.poll(repoRow, { message: 'the alias is saved' }).toMatchObject({ alias, aliasCustom: true });
      await expect(backoffice.owner.alias(scope.repo)).toHaveValue(alias);

      await test.step('clearing it resets to the generated default', async () => {
        await backoffice.owner.setAlias(scope.repo, '');

        await expect.poll(repoRow, { message: 'the alias is reset' }).toMatchObject({ aliasCustom: false });
        expect((await repoRow())?.alias).toMatch(/^Product /);
        await expect(backoffice.owner.alias(scope.repo)).toHaveValue('');
      });
    },
  );

  test(
    'the alias of a public repo cannot be edited (TC-BO-044)',
    { tag: [Tag.regression] },
    async ({ backoffice, apiContextFor, adminApi, cleanup }) => {
      const login = uniqueId('me');
      const scope = repoScope(login);
      const { github, target } = await setupGithub(
        { apiContextFor, adminApi, cleanup },
        { org: login, ownerType: 'user' },
      );
      await ping(github, target, scope, ['issues', 'pull_request']);

      await backoffice.owner.open(target.id);

      await expect(backoffice.owner.row(scope.repo)).toBeVisible();
      await expect(backoffice.owner.visibilityButton(scope.repo, 'public')).toBeVisible();
      await expect(backoffice.owner.alias(scope.repo)).not.toBeEditable();
    },
  );

  test(
    'a repo pinged without Pull requests shows the missing-mandatory warning in its events (TC-BO-045)',
    { tag: [Tag.smoke] },
    async ({ backoffice, apiContextFor, adminApi, cleanup }) => {
      const login = uniqueId('me');
      const lacking = repoScope(login);
      const complete = repoScope(login);
      const { github, target } = await setupGithub(
        { apiContextFor, adminApi, cleanup },
        { org: login, ownerType: 'user' },
      );
      await ping(github, target, lacking, ['issues']);
      await ping(github, target, complete, ['issues', 'pull_request']);

      await backoffice.owner.open(target.id);

      await expect(backoffice.owner.events(lacking.repo)).toContainText('Missing: Pull requests');
      await expect(backoffice.owner.events(complete.repo)).toContainText('Issues and pull requests');
      await expect(backoffice.owner.events(complete.repo)).not.toContainText('Missing');
    },
  );

  test(
    'the add-a-repo script for a personal owner asks for the secret and never contains it (TC-BO-046)',
    { tag: [Tag.smoke] },
    async ({ backoffice, apiContextFor, adminApi, cleanup }) => {
      const { target } = await setupGithub(
        { apiContextFor, adminApi, cleanup },
        { org: uniqueId('me'), ownerType: 'user' },
      );
      const { secret } = await expectJson(await adminApi.getSecret(target.id), RevealedSecretSchema);
      await backoffice.owner.open(target.id);
      await expect(backoffice.owner.addRepoPanel).toHaveAttribute('data-owner-type', 'user');

      await backoffice.owner.typeRepoNames('a b bad/name');

      await expect(backoffice.owner.addRepoScript).toContainText('read -rs');
      await expect(backoffice.owner.addRepoScript).toContainText(`/ingest/github/${target.id}`);
      await expect(backoffice.owner.addRepoScript).toContainText('for repo in a b;');
      await backoffice.owner.showSecret.click();
      const script = await backoffice.owner.scriptText();
      expect(script).not.toContain(secret);
      expect(script).not.toContain('bad/name');
    },
  );

  test(
    'creating a personal owner in the page opens its owner page and stores ownerType user (TC-BO-047)',
    { tag: [Tag.smoke] },
    async ({ backoffice, page, adminApi, cleanup }) => {
      const login = uniqueId('me');
      await backoffice.integrations.goto();

      await backoffice.integrations.createGithub('user', login);

      await expect(page).toHaveURL(/#integration-github-[0-9a-f]{6}$/);
      const id = new URL(page.url()).hash.replace('#integration-', '');
      cleanup.add(() => adminApi.deleteIntegration(id));
      await backoffice.owner.expectLoaded();
      await expect(backoffice.owner.root).toHaveAttribute('data-owner-type', 'user');
      const list = await expectJson(await adminApi.listIntegrations(), IntegrationListSchema);
      expect(list.find((i) => i.id === id)).toMatchObject({ kind: 'github', ownerType: 'user', org: login });
    },
  );

  test(
    'creating an organization in the page opens its setup page and stores ownerType organization (TC-BO-048)',
    { tag: [Tag.regression] },
    async ({ backoffice, page, adminApi, cleanup }) => {
      const login = uniqueId('acme');
      await backoffice.integrations.goto();

      await backoffice.integrations.createGithub('organization', login);

      await expect(page).toHaveURL(/#setup-github-[0-9a-f]{6}$/);
      const id = new URL(page.url()).hash.replace('#setup-', '');
      cleanup.add(() => adminApi.deleteIntegration(id));
      await backoffice.githubSetup.expectLoaded();
      const list = await expectJson(await adminApi.listIntegrations(), IntegrationListSchema);
      expect(list.find((i) => i.id === id)).toMatchObject({ kind: 'github', ownerType: 'organization', org: login });
    },
  );
});
