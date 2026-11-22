import { test, expect } from '@fixtures';
import { expectError, expectJson } from '@api/core/assertions';
import { AdminEventListSchema, IntegrationListSchema, ProductsSchema } from '@api/rest/admin/admin.schemas';
import {
  GithubAcceptedSchema,
  GithubEnvelopeSchema,
  GithubIgnoredSchema,
  GithubSkippedSchema,
} from '@api/rest/github/github.schemas';
import { githubFormBody } from '@api/rest/github/github.client';
import { setupGithub } from '@api/rest/github/github.setup';
import {
  buildGithubScope,
  buildIssue,
  buildIssueComment,
  buildIssuesEvent,
  buildPing,
  buildPullRequest,
  buildPullRequestEvent,
  buildSender,
} from '@data/factories/github.factory';
import { uniqueId } from '@utils/unique';
import { Tag } from '@utils/tags';

test.describe('ingest · github webhook', () => {
  test(
    'an issue opened, assigned and closed is accepted (202) and stored as town events (TC-ING-050)',
    { tag: [Tag.smoke] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup });
      const scope = buildGithubScope();
      const issue = buildIssue();
      const steps = ['opened', 'assigned', 'closed'].map((action) => ({ action, delivery: uniqueId('delivery') }));

      for (const { action, delivery } of steps) {
        const response = await github.send(
          target.ingestPath,
          'issues',
          buildIssuesEvent(scope, action, { ...issue, stateReason: 'completed' }),
          { secret: target.secret, delivery },
        );
        await expectJson(response, GithubAcceptedSchema, 202);
      }

      const events = await expectJson(await adminApi.events({ integration: target.id }), AdminEventListSchema);
      expect(events.map((e) => e.type)).toEqual(['issue.closed', 'issue.assigned', 'issue.opened']);
      expect(events.map((e) => e.id)).toEqual(steps.map((s) => `gh-${s.delivery}`).reverse());
      const opened = GithubEnvelopeSchema.parse(events[2]?.raw);
      expect(opened).toMatchObject({
        org: scope.org,
        product: { key: scope.repo, name: scope.repo, visibility: 'public' },
        task: { id: String(issue.number), title: issue.title, kind: 'issue' },
        data: { labels: ['#d73a4a'] },
      });
      expect(GithubEnvelopeSchema.parse(events[0]?.raw).data).toEqual({ reason: 'completed' });
    },
  );

  test(
    'a delivery signed with another secret is refused (401) and logged as rejected (TC-ING-051)',
    { tag: [Tag.smoke] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup });
      const body = buildIssuesEvent(buildGithubScope(), 'opened');

      const response = await github.send(target.ingestPath, 'issues', body, {
        secret: 'whsec_not-the-integrations-secret',
        delivery: uniqueId('delivery'),
      });

      await expectError(response, 401);
      const rejected = await expectJson(
        await adminApi.events({ integration: target.id, delivery: 'rejected' }),
        AdminEventListSchema,
      );
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({ kind: 'github', type: 'issues', status: 401 });
    },
  );

  test(
    'a delivery without X-Hub-Signature-256 is refused (401) (TC-ING-052)',
    { tag: [Tag.smoke] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup });

      const response = await github.send(target.ingestPath, 'issues', buildIssuesEvent(buildGithubScope(), 'opened'), {
        secret: target.secret,
        delivery: uniqueId('delivery'),
        unsigned: true,
      });

      await expectError(response, 401);
    },
  );

  test(
    'a forged signature value is refused (401) (TC-ING-053)',
    { tag: [Tag.regression] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup });

      const response = await github.send(target.ingestPath, 'issues', buildIssuesEvent(buildGithubScope(), 'opened'), {
        secret: target.secret,
        delivery: uniqueId('delivery'),
        signature: `sha256=${'0'.repeat(64)}`,
      });

      await expectError(response, 401);
    },
  );

  test(
    'the GitHub path of a GAOS integration is refused (401) even when signed (TC-ING-053)',
    { tag: [Tag.regression] },
    async ({ apiContextFor, adminApi, cleanup, integration }) => {
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup });
      const gaos = await integration('gaos');

      const response = await github.send(
        `/ingest/github/${gaos.id}`,
        'issues',
        buildIssuesEvent(buildGithubScope(), 'opened'),
        { secret: target.secret, delivery: uniqueId('delivery') },
      );

      await expectError(response, 401);
    },
  );

  test(
    'an unknown integration id is refused (401) (TC-ING-053)',
    { tag: [Tag.regression] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup });

      const response = await github.send(
        '/ingest/github/github-000000',
        'issues',
        buildIssuesEvent(buildGithubScope(), 'opened'),
        { secret: target.secret, delivery: uniqueId('delivery') },
      );

      await expectError(response, 401);
    },
  );

  test(
    'a signed form-encoded delivery is accepted (202) and stored like a JSON one (TC-ING-054)',
    { tag: [Tag.smoke] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup });
      const scope = buildGithubScope();
      const issue = buildIssue();
      const delivery = uniqueId('delivery');

      const response = await github.send(
        target.ingestPath,
        'issues',
        githubFormBody(buildIssuesEvent(scope, 'opened', issue)),
        { secret: target.secret, delivery, contentType: 'application/x-www-form-urlencoded' },
      );

      await expectJson(response, GithubAcceptedSchema, 202);
      const events = await expectJson(await adminApi.events({ integration: target.id }), AdminEventListSchema);
      expect(events.map((e) => e.type)).toEqual(['issue.opened']);
      expect(events.map((e) => e.id)).toEqual([`gh-${delivery}`]);
      expect(GithubEnvelopeSchema.parse(events[0]?.raw)).toMatchObject({
        org: scope.org,
        product: { key: scope.repo },
        task: { id: String(issue.number), title: issue.title, kind: 'issue' },
      });
    },
  );

  test(
    'a signed form-encoded delivery without a payload field is refused (422, field payload) (TC-ING-064)',
    { tag: [Tag.regression] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup });

      const response = await github.send(target.ingestPath, 'issues', `other=${uniqueId('value')}`, {
        secret: target.secret,
        delivery: uniqueId('delivery'),
        contentType: 'application/x-www-form-urlencoded',
      });

      await expectError(response, 422, 'payload');
    },
  );

  test(
    'a signed delivery of another content type is refused (415) (TC-ING-065)',
    { tag: [Tag.regression] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup });

      // Signed correctly: the signature is checked before the content type.
      const response = await github.send(
        target.ingestPath,
        'issues',
        JSON.stringify(buildIssuesEvent(buildGithubScope(), 'opened')),
        { secret: target.secret, delivery: uniqueId('delivery'), contentType: 'text/plain' },
      );

      await expectError(response, 415);
    },
  );

  test(
    'a ping is accepted (202) and saves the subscribed events on the integration (TC-ING-055)',
    { tag: [Tag.smoke] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup });
      const ticked = ['issues', 'pull_request', 'issue_comment'];

      const response = await github.send(target.ingestPath, 'ping', buildPing(buildGithubScope(), ticked), {
        secret: target.secret,
        delivery: uniqueId('delivery'),
      });

      await expectJson(response, GithubAcceptedSchema, 202);
      const list = await expectJson(await adminApi.listIntegrations(), IntegrationListSchema);
      expect(list.find((i) => i.id === target.id)?.events).toEqual(ticked);
      const events = await expectJson(await adminApi.events({ integration: target.id }), AdminEventListSchema);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ type: 'ping', delivery: 'ok' });
      expect(GithubEnvelopeSchema.parse(events[0]?.raw).data).toEqual({ events: ticked });
    },
  );

  test(
    'a signed delivery of an event the ping did not list is added to events, even when ignored (TC-ING-056)',
    { tag: [Tag.regression] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup });
      const scope = buildGithubScope();
      await github.send(target.ingestPath, 'ping', buildPing(scope, ['issues']), {
        secret: target.secret,
        delivery: uniqueId('delivery'),
      });

      // "fork" is an event the town does not use: still proof that it is ticked in GitHub.
      const response = await github.send(
        target.ingestPath,
        'fork',
        { forkee: { name: scope.repo } },
        {
          secret: target.secret,
          delivery: uniqueId('delivery'),
        },
      );

      await expectJson(response, GithubIgnoredSchema, 202);
      const list = await expectJson(await adminApi.listIntegrations(), IntegrationListSchema);
      expect(list.find((i) => i.id === target.id)?.events).toEqual(['issues', 'fork']);
    },
  );

  test(
    'the same X-GitHub-Delivery twice is a duplicate (409) (TC-ING-057)',
    { tag: [Tag.smoke] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup });
      const body = buildIssuesEvent(buildGithubScope(), 'opened');
      const delivery = uniqueId('delivery');
      await expectJson(
        await github.send(target.ingestPath, 'issues', body, { secret: target.secret, delivery }),
        GithubAcceptedSchema,
        202,
      );

      const redelivery = await github.send(target.ingestPath, 'issues', body, { secret: target.secret, delivery });

      await expectError(redelivery, 409);
      const events = await expectJson(await adminApi.events({ integration: target.id }), AdminEventListSchema);
      expect(events).toHaveLength(1);
    },
  );

  test(
    "a delivery for another organisation than the integration's is refused (422, field organization) (TC-ING-058)",
    { tag: [Tag.smoke] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const scope = buildGithubScope();
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup }, { org: scope.org });
      const other = buildGithubScope();

      const response = await github.send(target.ingestPath, 'issues', buildIssuesEvent(other, 'opened'), {
        secret: target.secret,
        delivery: uniqueId('delivery'),
      });

      await expectError(response, 422, 'organization');
      const rejected = await expectJson(
        await adminApi.events({ integration: target.id, delivery: 'rejected' }),
        AdminEventListSchema,
      );
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({ status: 422, type: 'issues' });
    },
  );

  test(
    'the organisation is compared case-insensitively (TC-ING-059)',
    { tag: [Tag.regression] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const scope = buildGithubScope();
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup }, { org: scope.org });

      const response = await github.send(
        target.ingestPath,
        'issues',
        buildIssuesEvent({ ...scope, org: scope.org.toUpperCase() }, 'opened'),
        { secret: target.secret, delivery: uniqueId('delivery') },
      );

      await expectJson(response, GithubAcceptedSchema, 202);
    },
  );

  test(
    'the first accepted delivery sets the organisation of an integration that has none (TC-ING-059)',
    { tag: [Tag.regression] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup });
      const scope = buildGithubScope();

      await expectJson(
        await github.send(target.ingestPath, 'issues', buildIssuesEvent(scope, 'opened'), {
          secret: target.secret,
          delivery: uniqueId('delivery'),
        }),
        GithubAcceptedSchema,
        202,
      );

      const list = await expectJson(await adminApi.listIntegrations(), IntegrationListSchema);
      expect(list.find((i) => i.id === target.id)?.org).toBe(scope.org);
    },
  );

  test(
    'a comment from a bot is skipped (202) and not stored (TC-ING-060)',
    { tag: [Tag.regression] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup });

      const response = await github.send(
        target.ingestPath,
        'issue_comment',
        buildIssueComment(buildGithubScope(), buildIssue(), buildSender('Bot')),
        { secret: target.secret, delivery: uniqueId('delivery') },
      );

      await expectJson(response, GithubSkippedSchema, 202);
      const events = await expectJson(await adminApi.events({ integration: target.id }), AdminEventListSchema);
      expect(events).toEqual([]);
    },
  );

  test(
    'an event and an action the town does not use are ignored (202) and not stored (TC-ING-061)',
    { tag: [Tag.regression] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup });
      const scope = buildGithubScope();

      const unknownEvent = await github.send(
        target.ingestPath,
        'fork',
        { forkee: { name: scope.repo } },
        {
          secret: target.secret,
          delivery: uniqueId('delivery'),
        },
      );
      const unusedAction = await github.send(target.ingestPath, 'issues', buildIssuesEvent(scope, 'deleted'), {
        secret: target.secret,
        delivery: uniqueId('delivery'),
      });

      await expectJson(unknownEvent, GithubIgnoredSchema, 202);
      await expectJson(unusedAction, GithubIgnoredSchema, 202);
      const events = await expectJson(await adminApi.events({ integration: target.id }), AdminEventListSchema);
      expect(events).toEqual([]);
    },
  );

  test(
    'a pull request that says "Fixes #n" is stored as pr.opened with the issue number (TC-ING-062)',
    { tag: [Tag.regression] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup });
      const issue = buildIssue();
      const pr = buildPullRequest({ body: `Fixes #${issue.number}` });

      const response = await github.send(
        target.ingestPath,
        'pull_request',
        buildPullRequestEvent(buildGithubScope(), 'opened', pr),
        { secret: target.secret, delivery: uniqueId('delivery') },
      );

      await expectJson(response, GithubAcceptedSchema, 202);
      const events = await expectJson(await adminApi.events({ integration: target.id }), AdminEventListSchema);
      expect(events).toHaveLength(1);
      const envelope = GithubEnvelopeSchema.parse(events[0]?.raw);
      expect(envelope.type).toBe('pr.opened');
      expect(envelope.task).toMatchObject({ id: String(pr.number), kind: 'pr' });
      expect(envelope.data).toEqual({ pr: pr.number, issue: issue.number, draft: false });
    },
  );

  test(
    'an issue in a private repository creates a hidden product (TC-ING-063)',
    { tag: [Tag.regression] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup });
      const scope = buildGithubScope({ private: true });

      await expectJson(
        await github.send(target.ingestPath, 'issues', buildIssuesEvent(scope, 'opened'), {
          secret: target.secret,
          delivery: uniqueId('delivery'),
        }),
        GithubAcceptedSchema,
        202,
      );

      const { products } = await expectJson(await adminApi.products(), ProductsSchema);
      const product = products.find((p) => p.key === scope.repo);
      expect(product).toMatchObject({ visibility: 'hidden' });
      expect(product?.alias).not.toBe(scope.repo);
    },
  );
});
