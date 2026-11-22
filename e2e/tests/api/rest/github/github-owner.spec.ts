import { test, expect } from '@fixtures';
import { expectError, expectJson } from '@api/core/assertions';
import type { AdminClient } from '@api/rest/admin/admin.client';
import { IntegrationListSchema, IntegrationSchema, ProductSchema, ProductsSchema } from '@api/rest/admin/admin.schemas';
import { CreatedGithubIntegrationSchema, GithubAcceptedSchema } from '@api/rest/github/github.schemas';
import { setupGithub } from '@api/rest/github/github.setup';
import type { GithubClient } from '@api/rest/github/github.client';
import {
  buildGithubScope,
  buildIssuesEvent,
  buildPing,
  buildRepoPing,
  type GithubPayload,
  type GithubScope,
} from '@data/factories/github.factory';
import { uniqueId } from '@utils/unique';
import { Tag } from '@utils/tags';

// A personal GitHub account has no account-wide webhook: every repo has its own, so the owner keeps state per repo.

async function owner(adminApi: AdminClient, id: string) {
  const list = await expectJson(await adminApi.listIntegrations(), IntegrationListSchema);
  const row = list.find((i) => i.id === id);
  expect(row, `integration ${id} is listed`).toBeDefined();
  return row!;
}

/** A user-owned repo scope whose names sort as given: `<tag>-alpha` before `<tag>-beta`. */
function userRepos(login: string, ...suffixes: { suffix: string; private?: boolean }[]): GithubScope[] {
  const tag = uniqueId('r');
  return suffixes.map((s) => ({
    org: login,
    repo: `${tag}-${s.suffix}`,
    private: s.private ?? false,
    ownerType: 'user',
  }));
}

async function deliver(github: GithubClient, path: string, secret: string, event: string, body: GithubPayload) {
  const response = await github.send(path, event, body, { secret, delivery: uniqueId('delivery') });
  await expectJson(response, GithubAcceptedSchema, 202);
}

test.describe('admin · github owner type and per-repo state', () => {
  test(
    'an integration created as a personal owner lists ownerType user and no repos (TC-ADM-070)',
    { tag: [Tag.smoke] },
    async ({ adminApi, cleanup }) => {
      const created = await expectJson(
        await adminApi.createIntegration({
          kind: 'github',
          name: uniqueId('github'),
          org: uniqueId('me'),
          ownerType: 'user',
        }),
        CreatedGithubIntegrationSchema,
        201,
      );
      cleanup.add(() => adminApi.deleteIntegration(created.integration.id));

      const row = await owner(adminApi, created.integration.id);

      expect(created.integration.ownerType).toBe('user');
      expect(row.ownerType).toBe('user');
      expect(row.repos).toEqual([]);
    },
  );

  test(
    'an invalid ownerType is refused (422) on create and on change (TC-ADM-071)',
    { tag: [Tag.regression] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const { target } = await setupGithub({ apiContextFor, adminApi, cleanup });

      const created = await adminApi.createIntegration({ kind: 'github', name: uniqueId('github'), ownerType: 'team' });
      const changed = await adminApi.updateIntegration(target.id, { ownerType: 'team' });

      await expectError(created, 422);
      await expectError(changed, 422);
      expect((await owner(adminApi, target.id)).ownerType).toBe('');
    },
  );

  test(
    'ownerType can be set when changing an integration (TC-ADM-072)',
    { tag: [Tag.regression] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const { target } = await setupGithub({ apiContextFor, adminApi, cleanup });

      await expectJson(await adminApi.updateIntegration(target.id, { ownerType: 'organization' }), IntegrationSchema);

      expect((await owner(adminApi, target.id)).ownerType).toBe('organization');
    },
  );

  test(
    "two repo pings keep each repo's hook events, sorted by name, and the integration lists their union (TC-ING-066)",
    { tag: [Tag.smoke] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const login = uniqueId('me');
      const [alpha, beta] = userRepos(login, { suffix: 'alpha' }, { suffix: 'beta', private: true });
      const { github, target } = await setupGithub(
        { apiContextFor, adminApi, cleanup },
        { org: login, ownerType: 'user' },
      );

      await deliver(github, target.ingestPath, target.secret, 'ping', buildRepoPing(beta!, ['issues', 'push']));
      await deliver(
        github,
        target.ingestPath,
        target.secret,
        'ping',
        buildRepoPing(alpha!, ['issues', 'pull_request']),
      );

      const row = await owner(adminApi, target.id);
      expect(row.repos.map((r) => r.name)).toEqual([alpha!.repo, beta!.repo]);
      expect(row.repos[0]).toMatchObject({
        private: false,
        hookEvents: ['issues', 'pull_request'],
        visibility: 'public',
        today: 0,
        rejected: 0,
      });
      expect(row.repos[1]).toMatchObject({ private: true, hookEvents: ['issues', 'push'], visibility: 'hidden' });
      expect(row.events).toEqual(['issues', 'pull_request', 'push']);
      const { products } = await expectJson(await adminApi.products(), ProductsSchema);
      expect(products.find((p) => p.key === alpha!.repo)).toMatchObject({ visibility: 'public' });
      expect(products.find((p) => p.key === beta!.repo)).toMatchObject({ visibility: 'hidden' });
    },
  );

  test(
    'the owner type is adopted from the first ping (user) and never overwritten by a later one (TC-ING-067)',
    { tag: [Tag.regression] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const login = uniqueId('me');
      const [repo] = userRepos(login, { suffix: 'alpha' });
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup }, { org: login });

      await deliver(github, target.ingestPath, target.secret, 'ping', buildRepoPing(repo!));
      expect((await owner(adminApi, target.id)).ownerType).toBe('user');
      // An organization object on a later payload must not flip an owner that is already known.
      await deliver(
        github,
        target.ingestPath,
        target.secret,
        'ping',
        buildPing({ org: login, repo: repo!.repo, private: false }),
      );

      expect((await owner(adminApi, target.id)).ownerType).toBe('user');
    },
  );

  test(
    'an organization ping sets the owner type organization when none was chosen (TC-ING-068)',
    { tag: [Tag.regression] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const scope = buildGithubScope();
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup }, { org: scope.org });

      await deliver(github, target.ingestPath, target.secret, 'ping', buildPing(scope));

      expect((await owner(adminApi, target.id)).ownerType).toBe('organization');
    },
  );

  test(
    'a delivery after the ping counts on that repo today and stamps its last event (TC-ING-069)',
    { tag: [Tag.smoke] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const login = uniqueId('me');
      const [repo, other] = userRepos(login, { suffix: 'alpha' }, { suffix: 'beta' });
      const { github, target } = await setupGithub(
        { apiContextFor, adminApi, cleanup },
        { org: login, ownerType: 'user' },
      );
      await deliver(github, target.ingestPath, target.secret, 'ping', buildRepoPing(repo!));
      await deliver(github, target.ingestPath, target.secret, 'ping', buildRepoPing(other!));

      await deliver(github, target.ingestPath, target.secret, 'issues', buildIssuesEvent(repo!, 'opened'));

      const row = await owner(adminApi, target.id);
      const hit = row.repos.find((r) => r.name === repo!.repo);
      const idle = row.repos.find((r) => r.name === other!.repo);
      expect(hit?.today).toBe(1);
      expect(hit?.lastEventAt).not.toMatch(/^0001-/);
      expect(idle?.today).toBe(0);
      expect(idle?.lastEventAt).toMatch(/^0001-/);
    },
  );

  test(
    'a delivery for another owner is refused (422); it counts on a known repo but never adds one (TC-ING-070)',
    { tag: [Tag.regression] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const login = uniqueId('me');
      const [known] = userRepos(login, { suffix: 'alpha' });
      const { github, target } = await setupGithub(
        { apiContextFor, adminApi, cleanup },
        { org: login, ownerType: 'user' },
      );
      await deliver(github, target.ingestPath, target.secret, 'ping', buildRepoPing(known!));
      const foreign = (repo: string): GithubScope => ({
        org: uniqueId('stranger'),
        repo,
        private: false,
        ownerType: 'user',
      });

      const onKnown = await github.send(target.ingestPath, 'issues', buildIssuesEvent(foreign(known!.repo), 'opened'), {
        secret: target.secret,
        delivery: uniqueId('delivery'),
      });
      const onUnknown = await github.send(
        target.ingestPath,
        'issues',
        buildIssuesEvent(foreign(uniqueId('stray')), 'opened'),
        { secret: target.secret, delivery: uniqueId('delivery') },
      );

      await expectError(onKnown, 422, 'organization');
      await expectError(onUnknown, 422, 'organization');
      const row = await owner(adminApi, target.id);
      expect(row.repos.map((r) => r.name)).toEqual([known!.repo]);
      expect(row.repos[0]).toMatchObject({ rejected: 1, today: 0 });
      expect(row.repos[0]?.lastRejectedAt).not.toMatch(/^0001-/);
    },
  );

  test(
    'a custom alias on a hidden repo is flagged custom and an empty alias resets it to "Product X" (TC-ADM-073)',
    { tag: [Tag.smoke] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const login = uniqueId('me');
      const [secret] = userRepos(login, { suffix: 'alpha', private: true });
      const { github, target } = await setupGithub(
        { apiContextFor, adminApi, cleanup },
        { org: login, ownerType: 'user' },
      );
      await deliver(github, target.ingestPath, target.secret, 'ping', buildRepoPing(secret!));
      const alias = uniqueId('Vault');

      await expectJson(await adminApi.putProduct(secret!.repo, { alias }), ProductSchema);
      const custom = (await owner(adminApi, target.id)).repos[0];
      await expectJson(await adminApi.putProduct(secret!.repo, { alias: '' }), ProductSchema);
      const reset = (await owner(adminApi, target.id)).repos[0];

      expect(custom).toMatchObject({ alias, aliasCustom: true });
      expect(reset?.aliasCustom).toBe(false);
      expect(reset?.alias).toMatch(/^Product /);
      expect(reset?.alias).toBe(reset?.defaultAlias);
    },
  );

  test(
    'an empty alias on a public repo changes nothing (TC-ADM-074)',
    { tag: [Tag.regression] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const login = uniqueId('me');
      const [open] = userRepos(login, { suffix: 'alpha' });
      const { github, target } = await setupGithub(
        { apiContextFor, adminApi, cleanup },
        { org: login, ownerType: 'user' },
      );
      await deliver(github, target.ingestPath, target.secret, 'ping', buildRepoPing(open!));

      await expectJson(await adminApi.putProduct(open!.repo, { alias: '' }), ProductSchema);

      expect((await owner(adminApi, target.id)).repos[0]).toMatchObject({
        visibility: 'public',
        alias: open!.repo,
        aliasCustom: false,
      });
    },
  );
});
