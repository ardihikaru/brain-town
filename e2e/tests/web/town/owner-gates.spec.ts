import { test, expect } from '@fixtures';
import { expectJson } from '@api/core/assertions';
import { GithubAcceptedSchema } from '@api/rest/github/github.schemas';
import { setupGithub } from '@api/rest/github/github.setup';
import { buildGithubScope, buildIssue, buildIssuesEvent, type GithubScope } from '@data/factories/github.factory';
import { uniqueId } from '@utils/unique';
import { Tag } from '@utils/tags';

// The town draws one GitHub Valley gate per real owner from GET /api/town. The drawing itself is the designer's;
// these tests read the plain-data hook (town.home.valley()) and assert facts that hold for any hall cap. The valley has
// 3 gate plots and placement depends on recent activity, so `placed` is not deterministic on the shared stack: tests
// assert owner, type, halls and over (halls and over are defined for unplaced owners too).

function integrationFor(scope: GithubScope) {
  return { org: scope.org, ownerType: scope.ownerType ?? 'organization' };
}

test.describe('town · github valley owner gates', () => {
  test(
    'an owner that exists before the page loads is drawn from the snapshot (TC-TOWN-020)',
    { tag: [Tag.smoke] },
    async ({ town, apiContextFor, adminApi, cleanup }) => {
      const scope = buildGithubScope({ ownerType: 'user' });
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup }, integrationFor(scope));
      await expectJson(
        await github.send(target.ingestPath, 'issues', buildIssuesEvent(scope, 'opened', buildIssue()), {
          secret: target.secret,
          delivery: uniqueId('delivery'),
        }),
        GithubAcceptedSchema,
        202,
      );

      await town.home.goto();

      await expect
        .poll(async () => (await town.home.valley()).owners[scope.org], { message: 'owner is drawn from the snapshot' })
        .toMatchObject({ type: 'user', hidden: false, halls: [scope.repo], over: 0 });
      const owner = (await town.home.valley()).owners[scope.org];
      expect(typeof owner?.placed).toBe('boolean');
      expect((await town.home.valley()).source).toBe('live');
    },
  );

  test(
    'a new owner that first appears while the page is open is added without a reload (TC-TOWN-021)',
    { tag: [Tag.smoke] },
    async ({ town, apiContextFor, adminApi, cleanup }) => {
      const scope = buildGithubScope();
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup }, integrationFor(scope));
      await town.home.goto();
      await expect(town.home.mode).toHaveText('live SSE');
      expect((await town.home.valley()).owners[scope.org]).toBeUndefined();

      await expectJson(
        await github.send(target.ingestPath, 'issues', buildIssuesEvent(scope, 'opened', buildIssue()), {
          secret: target.secret,
          delivery: uniqueId('delivery'),
        }),
        GithubAcceptedSchema,
        202,
      );

      // The owner first appears with type '' and the town refetches /api/town (debounced) to learn the type.
      await expect
        .poll(async () => (await town.home.valley()).owners[scope.org], {
          message: 'new owner is added and its type is learned from the refetch',
        })
        .toMatchObject({ type: scope.ownerType ?? 'organization', halls: [scope.repo], over: 0 });
      expect(typeof (await town.home.valley()).owners[scope.org]?.placed).toBe('boolean');
      expect((await town.home.valley()).source).toBe('live');
    },
  );

  test(
    'a private repo is a hall under its alias and the real name is not in the town state (TC-TOWN-022)',
    { tag: [Tag.smoke] },
    async ({ town, apiContextFor, adminApi, cleanup }) => {
      const scope = buildGithubScope({ private: true });
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup }, integrationFor(scope));
      await expectJson(
        await github.send(target.ingestPath, 'issues', buildIssuesEvent(scope, 'opened', buildIssue()), {
          secret: target.secret,
          delivery: uniqueId('delivery'),
        }),
        GithubAcceptedSchema,
        202,
      );

      await town.home.goto();

      await expect
        .poll(async () => (await town.home.valley()).owners[scope.org]?.halls, { message: 'owner has its alias hall' })
        .toHaveLength(1);
      const owner = (await town.home.valley()).owners[scope.org];
      expect(owner?.halls[0]).toMatch(/^Product /);
      expect(owner?.over).toBe(0);
      expect(await town.home.snapshotText()).not.toContain(scope.repo);
    },
  );
});
