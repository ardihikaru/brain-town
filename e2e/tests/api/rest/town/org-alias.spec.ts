import { test, expect } from '@fixtures';
import { expectJson } from '@api/core/assertions';
import { OrgSchema } from '@api/rest/admin/admin.schemas';
import { GithubAcceptedSchema } from '@api/rest/github/github.schemas';
import { setupGithub } from '@api/rest/github/github.setup';
import { TownClient } from '@api/rest/town/town.client';
import { TownSnapshotSchema } from '@api/rest/town/town.schemas';
import { buildGithubScope, buildIssue, buildIssuesEvent } from '@data/factories/github.factory';
import { uniqueId } from '@utils/unique';
import { Tag } from '@utils/tags';

test.describe('town snapshot · org alias', () => {
  test(
    'a public owner with an alias is listed under the alias, with its type, and the key appears nowhere in its entry (TC-STR-071)',
    { tag: [Tag.smoke] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const scope = buildGithubScope({ org: uniqueId('me').toLowerCase(), ownerType: 'user' });
      const alias = uniqueId('Town Name');
      const { github, target } = await setupGithub(
        { apiContextFor, adminApi, cleanup },
        { org: scope.org, ownerType: 'user' },
      );
      await expectJson(
        await github.send(target.ingestPath, 'issues', buildIssuesEvent(scope, 'opened', buildIssue()), {
          secret: target.secret,
          delivery: uniqueId('delivery'),
        }),
        GithubAcceptedSchema,
        202,
      );
      cleanup.add(() => adminApi.putOrg(scope.org, { alias: '' }));
      await expectJson(await adminApi.putOrg(scope.org, { alias }), OrgSchema);
      const town = new TownClient(await apiContextFor('anonymous'));

      const snapshot = await expectJson(await town.snapshot(), TownSnapshotSchema);

      const owner = snapshot.owners.find((o) => o.name === alias);
      expect(owner).toMatchObject({ name: alias, type: 'user', hidden: false });
      expect(owner?.repos.map((r) => r.name)).toEqual([scope.repo]);
      expect(JSON.stringify(owner)).not.toContain(scope.org);
      expect(snapshot.owners.find((o) => o.name === scope.org)).toBeUndefined();
    },
  );
});
