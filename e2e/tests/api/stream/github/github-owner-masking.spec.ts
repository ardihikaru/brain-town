import { test, expect } from '@fixtures';
import { expectJson } from '@api/core/assertions';
import { IntegrationListSchema } from '@api/rest/admin/admin.schemas';
import { GithubAcceptedSchema, GithubPublicEventSchema } from '@api/rest/github/github.schemas';
import { setupGithub } from '@api/rest/github/github.setup';
import { buildIssue, buildIssuesEvent, buildRepoPing } from '@data/factories/github.factory';
import { uniqueId } from '@utils/unique';
import { Tag } from '@utils/tags';

test.describe('stream · github private repo of a personal owner', () => {
  test(
    'an event of a repo registered hidden by its ping shows its alias on /events, never its name (TC-STR-044)',
    { tag: [Tag.smoke] },
    async ({ sse, apiContextFor, adminApi, cleanup }) => {
      const login = uniqueId('me');
      const scope = { org: login, repo: uniqueId('vault'), private: true, ownerType: 'user' } as const;
      const { github, target } = await setupGithub(
        { apiContextFor, adminApi, cleanup },
        { org: login, ownerType: 'user' },
      );
      await expectJson(
        await github.send(target.ingestPath, 'ping', buildRepoPing(scope), {
          secret: target.secret,
          delivery: uniqueId('delivery'),
        }),
        GithubAcceptedSchema,
        202,
      );
      const list = await expectJson(await adminApi.listIntegrations(), IntegrationListSchema);
      const alias = list.find((i) => i.id === target.id)?.repos[0]?.alias;
      const stream = await sse.connect('public');
      const issue = buildIssue();
      const delivery = uniqueId('delivery');

      await expectJson(
        await github.send(target.ingestPath, 'issues', buildIssuesEvent(scope, 'opened', issue), {
          secret: target.secret,
          delivery,
        }),
        GithubAcceptedSchema,
        202,
      );

      const pushed = await stream.waitFor(
        (e) => GithubPublicEventSchema.safeParse(e.json).data?.id === `gh-${delivery}`,
      );
      const body = GithubPublicEventSchema.parse(pushed.json);
      expect(alias).toMatch(/^Product /);
      expect(body.payload.product).toEqual({ key: alias, name: alias, visibility: 'hidden' });
      expect(JSON.stringify(body)).not.toContain(scope.repo);
      expect(JSON.stringify(body)).not.toContain(issue.title);
    },
  );
});
