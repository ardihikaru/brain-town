import { test, expect } from '@fixtures';
import { expectJson } from '@api/core/assertions';
import { OrgSchema } from '@api/rest/admin/admin.schemas';
import { GithubAcceptedSchema } from '@api/rest/github/github.schemas';
import { setupGithub } from '@api/rest/github/github.setup';
import { TownClient } from '@api/rest/town/town.client';
import { TownSnapshotSchema } from '@api/rest/town/town.schemas';
import { buildGithubScope, buildIssue, buildIssuesEvent, type GithubScope } from '@data/factories/github.factory';
import { uniqueId } from '@utils/unique';
import { Tag } from '@utils/tags';

// GET /api/town is public and masked through the same path as /events. Orgs and products cannot be deleted, so every
// test uses its own unique owner and repo names and reads only its own entries.

/** An owner with a GitHub integration, plus one delivered issue in `scope` so its repo exists. */
async function ownerWithIssue(fx: Parameters<typeof setupGithub>[0], scope: GithubScope) {
  const { github, target } = await setupGithub(fx, {
    org: scope.org,
    ownerType: scope.ownerType ?? 'organization',
  });
  await expectJson(
    await github.send(target.ingestPath, 'issues', buildIssuesEvent(scope, 'opened', buildIssue()), {
      secret: target.secret,
      delivery: uniqueId('delivery'),
    }),
    GithubAcceptedSchema,
    202,
  );
}

test.describe('town snapshot · GET /api/town', () => {
  test(
    'is public, uncached and lists a fresh owner with its public repo and type (TC-STR-050)',
    { tag: [Tag.smoke] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const scope = buildGithubScope({ ownerType: 'user' });
      await ownerWithIssue({ apiContextFor, adminApi, cleanup }, scope);
      const town = new TownClient(await apiContextFor('anonymous'));

      const response = await town.snapshot();
      const snapshot = await expectJson(response, TownSnapshotSchema);

      expect(response.headers()['cache-control']).toBe('no-store');
      const owner = snapshot.owners.find((o) => o.name === scope.org);
      expect(owner).toMatchObject({ name: scope.org, type: 'user', hidden: false });
      expect(owner?.repos.map((r) => r.name)).toEqual([scope.repo]);
      expect(owner?.repos[0]?.hidden).toBe(false);
      expect(owner?.lastEventAt).toBeDefined();
    },
  );

  test(
    'an organization owner reports type organization (TC-STR-051)',
    { tag: [Tag.regression] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const scope = buildGithubScope({ ownerType: 'organization' });
      await ownerWithIssue({ apiContextFor, adminApi, cleanup }, scope);
      const town = new TownClient(await apiContextFor('anonymous'));

      const snapshot = await expectJson(await town.snapshot(), TownSnapshotSchema);

      expect(snapshot.owners.find((o) => o.name === scope.org)).toMatchObject({ type: 'organization' });
    },
  );

  test(
    'a private repo shows only as an alias and its real name is nowhere in the response (TC-STR-052)',
    { tag: [Tag.smoke] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const scope = buildGithubScope({ private: true });
      await ownerWithIssue({ apiContextFor, adminApi, cleanup }, scope);
      const town = new TownClient(await apiContextFor('anonymous'));

      const response = await town.snapshot();
      const snapshot = await expectJson(response, TownSnapshotSchema);

      const owner = snapshot.owners.find((o) => o.name === scope.org);
      expect(owner?.repos).toHaveLength(1);
      expect(owner?.repos[0]?.hidden).toBe(true);
      expect(owner?.repos[0]?.name).toMatch(/^Product /);
      expect(await response.text()).not.toContain(scope.repo);
    },
  );

  test(
    'a hidden owner shows under its alias and neither its key nor its repo names appear (TC-STR-053)',
    { tag: [Tag.smoke] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const scope = buildGithubScope();
      await ownerWithIssue({ apiContextFor, adminApi, cleanup }, scope);
      const alias = uniqueId('Org');
      cleanup.add(() => adminApi.putOrg(scope.org, { visibility: 'public' }));
      await expectJson(await adminApi.putOrg(scope.org, { visibility: 'hidden', alias }), OrgSchema);
      const town = new TownClient(await apiContextFor('anonymous'));

      const response = await town.snapshot();
      const snapshot = await expectJson(response, TownSnapshotSchema);

      const owner = snapshot.owners.find((o) => o.name === alias);
      // Hidden owners report no type (privacy). A public repo of a hidden org is published under the org's alias.
      expect(owner).toMatchObject({ hidden: true, type: '' });
      expect(owner?.repos).toHaveLength(1);
      expect(owner?.repos.every((r) => r.hidden && r.name !== scope.repo && r.name !== scope.org)).toBe(true);
      const text = await response.text();
      expect(text).not.toContain(scope.org);
      expect(text).not.toContain(scope.repo);
    },
  );
});
