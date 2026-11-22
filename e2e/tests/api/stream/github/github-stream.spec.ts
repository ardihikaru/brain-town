import { test, expect } from '@fixtures';
import { expectJson } from '@api/core/assertions';
import { AdminEventSchema } from '@api/rest/admin/admin.schemas';
import { GithubAcceptedSchema, GithubEnvelopeSchema, GithubPublicEventSchema } from '@api/rest/github/github.schemas';
import { setupGithub } from '@api/rest/github/github.setup';
import {
  buildGithubScope,
  buildIssue,
  buildIssueComment,
  buildIssuesEvent,
  buildPing,
} from '@data/factories/github.factory';
import { uniqueId } from '@utils/unique';
import { Tag } from '@utils/tags';

// Subscribe first, then deliver through the signed GitHub client, then assert the pushed event (AGENTS.md §7.2).

/** The window in which grouped deliveries are merged (docs/integrations/github.md, Rollups). */
const ROLLUP_WINDOW_MS = 15_000;

test.describe('stream · github events', () => {
  test(
    'an issue opened is pushed on /events with the town envelope (TC-STR-040)',
    { tag: [Tag.smoke] },
    async ({ sse, apiContextFor, adminApi, cleanup }) => {
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup });
      const stream = await sse.connect('public');
      const scope = buildGithubScope();
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
      expect(pushed.event).toBe('issue.opened');
      expect(pushed.id).toBe(String(body.seq));
      expect(body.payload).toEqual({
        id: `gh-${delivery}`,
        type: 'issue.opened',
        at: body.payload.at,
        org: scope.org,
        product: { key: scope.repo, name: scope.repo, visibility: 'public' },
        task: { id: String(issue.number), title: issue.title, kind: 'issue' },
        data: { labels: ['#d73a4a'] },
      });
    },
  );

  test(
    'five comments on one issue become one issue.commented rollup with count 5 (TC-STR-041)',
    { tag: [Tag.smoke] },
    async ({ sse, apiContextFor, adminApi, cleanup }) => {
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup });
      const stream = await sse.connect('public');
      const scope = buildGithubScope();
      const issue = buildIssue();
      const deliveries = Array.from({ length: 5 }, () => uniqueId('delivery'));
      const texts = deliveries.map(() => uniqueId('comment'));

      for (const [i, delivery] of deliveries.entries()) {
        const response = await github.send(
          target.ingestPath,
          'issue_comment',
          buildIssueComment(scope, issue, undefined, texts[i]),
          { secret: target.secret, delivery },
        );
        await expectJson(response, GithubAcceptedSchema, 202);
      }

      // The server holds grouped deliveries for a 15 s window before it publishes one event, so this is
      // the one bounded wait that must outlast it: window plus one second of flush tick plus a margin.
      const rollup = await stream.waitForJson(
        GithubPublicEventSchema,
        (e) => e.type === 'issue.commented' && e.payload.product?.key === scope.repo,
        ROLLUP_WINDOW_MS + 10_000,
      );
      expect(rollup.payload).toMatchObject({
        id: `gh-roll-${deliveries[0]}`,
        type: 'issue.commented',
        org: scope.org,
        task: { id: String(issue.number), kind: 'issue' },
        data: { count: 5 },
      });
      const rollups = stream
        .jsonEvents(GithubPublicEventSchema)
        .filter((e) => e.type === 'issue.commented' && e.payload.product?.key === scope.repo);
      expect(rollups).toHaveLength(1);
      for (const text of texts) expect(JSON.stringify(rollup)).not.toContain(text);
    },
  );

  test(
    'an issue in a private repository is pushed under an alias with no title (TC-STR-042)',
    { tag: [Tag.smoke] },
    async ({ sse, apiContextFor, adminApi, cleanup }) => {
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup });
      const stream = await sse.connect('public');
      const scope = buildGithubScope({ private: true });
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

      const body = await stream.waitForJson(GithubPublicEventSchema, (e) => e.id === `gh-${delivery}`);
      expect(body.payload.product).toMatchObject({ visibility: 'hidden' });
      expect(body.payload.product?.name).not.toBe(scope.repo);
      expect(body.payload.task).toEqual({ id: String(issue.number), kind: 'issue' });
      expect(JSON.stringify(body)).not.toContain(issue.title);
      expect(JSON.stringify(body)).not.toContain(scope.repo);
    },
  );

  test(
    'a ping is pushed on /admin/events with the ticked events (TC-STR-043)',
    { tag: [Tag.regression] },
    async ({ sse, apiContextFor, adminApi, cleanup }) => {
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup });
      const stream = await sse.connect('admin');
      const ticked = ['issues', 'star'];

      await expectJson(
        await github.send(target.ingestPath, 'ping', buildPing(buildGithubScope(), ticked), {
          secret: target.secret,
          delivery: uniqueId('delivery'),
        }),
        GithubAcceptedSchema,
        202,
      );

      const body = await stream.waitForJson(AdminEventSchema, (e) => e.integration === target.id && e.type === 'ping');
      expect(body).toMatchObject({ kind: 'github', delivery: 'ok' });
      expect(GithubEnvelopeSchema.parse(body.raw).data).toEqual({ events: ticked });
    },
  );
});
