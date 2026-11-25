import { test, expect } from '@fixtures';
import { expectJson, expectStatus } from '@api/core/assertions';
import { ConsumerEventSchema, PublicEventSchema } from '@api/rest/admin/admin.schemas';
import { GithubAcceptedSchema } from '@api/rest/github/github.schemas';
import { setupGithub } from '@api/rest/github/github.setup';
import { buildGithubScope, buildPullRequest, buildPullRequestEvent } from '@data/factories/github.factory';
import { uniqueId } from '@utils/unique';
import { Tag } from '@utils/tags';

/**
 * The consumer stream: a scoped machine reader that gets the stored envelope,
 * not the public view.
 *
 * The public stream hides a hidden product's real name and every title. A
 * consumer that named the repository it wants gets the real name. That is the
 * whole point of the path, so both halves are asserted here: the consumer sees
 * it, and the public stream still does not.
 *
 * The events are real GitHub deliveries, because a consumer exists for GitHub:
 * the payload has the product object and the task title that a QA step does not.
 */
test.describe('stream · consumers', () => {
  test(
    'a consumer scoped to a repository receives that repository’s events and no other (TC-STR-080)',
    {
      tag: [Tag.regression],
    },
    async ({ sse, apiContextFor, adminApi, cleanup, consumer }) => {
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup });
      const scope = buildGithubScope();
      const mine = scope.repo;
      const theirs = uniqueId('other-repo');
      const reader = await consumer({ scope: { kinds: ['github'], repos: [mine] } });

      const stream = await sse.connect('consumer', { headers: { authorization: `Bearer ${reader.token}` } });
      const delivery = uniqueId('delivery');
      await expectJson(
        await github.send(target.ingestPath, 'pull_request', buildPullRequestEvent(scope, 'opened'), {
          secret: target.secret,
          delivery,
        }),
        GithubAcceptedSchema,
        202,
      );

      const body = await stream.waitForJson(ConsumerEventSchema, (e) => e.payload.id === `gh-${delivery}`);
      expect(body.productKey).toBe(mine);
      expect((body.payload.product as { key?: string }).key).toBe(mine);

      // A repository outside the scope never arrives.
      const other = buildGithubScope({ org: scope.org, repo: theirs });
      const otherDelivery = uniqueId('delivery');
      await expectJson(
        await github.send(target.ingestPath, 'pull_request', buildPullRequestEvent(other, 'opened'), {
          secret: target.secret,
          delivery: otherDelivery,
        }),
        GithubAcceptedSchema,
        202,
      );
      await stream.waitFor((e) => e.event === 'pr.opened', 2000);
      const seen = stream.events.map((e) => (e.json as { productKey?: string })?.productKey);
      expect(seen).toContain(mine);
      expect(seen).not.toContain(theirs);
    },
  );

  test(
    'a consumer of a hidden product sees its real name while the public stream stays masked (TC-STR-081)',
    {
      tag: [Tag.regression],
    },
    async ({ sse, apiContextFor, adminApi, cleanup, consumer }) => {
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup });
      const scope = buildGithubScope({ private: true });
      const product = scope.repo;
      const alias = uniqueId('Secret');

      const reader = await consumer({ scope: { kinds: ['github'], repos: [product] } });
      const readerStream = await sse.connect('consumer', { headers: { authorization: `Bearer ${reader.token}` } });
      const publicStream = await sse.connect('public');

      // Both streams are open before the delivery arrives, so each one is
      // decided by what it sends, not by what it had already stored.
      const pr = buildPullRequest();
      const delivery = uniqueId('delivery');
      await expectJson(
        await github.send(target.ingestPath, 'pull_request', buildPullRequestEvent(scope, 'opened', pr), {
          secret: target.secret,
          delivery,
        }),
        GithubAcceptedSchema,
        202,
      );

      const mine = await readerStream.waitForJson(ConsumerEventSchema, (e) => e.payload.id === `gh-${delivery}`);
      expect(mine.productKey).toBe(product);
      expect((mine.payload.task as { title?: string }).title).toBe(pr.title);

      const theirs = await publicStream.waitForJson(PublicEventSchema, (e) => e.payload.id === `gh-${delivery}`);
      expect(JSON.stringify(theirs)).not.toContain(product);
      expect(JSON.stringify(theirs)).not.toContain(pr.title);
      expect((theirs.payload.product as { key?: string }).key).not.toBe(product);
      expect(alias).toBeTruthy();
    },
  );

  test(
    'a consumer token is refused without a token, with a wrong token, after a rotation and after a delete (TC-STR-082)',
    {
      tag: [Tag.regression],
    },
    async ({ adminApi, sse, consumer }) => {
      const reader = await consumer({ scope: { kinds: ['github'] } });

      // A stream that answers 401 never opens: the client throws.
      await expect(sse.connect('consumer')).rejects.toThrow(/401/);
      await expect(sse.connect('consumer', { headers: { authorization: 'Bearer bt_c_not-a-token' } })).rejects.toThrow(
        /401/,
      );

      // The token works.
      const ok = await sse.connect('consumer', { headers: { authorization: `Bearer ${reader.token}` } });
      expect(ok.events).toHaveLength(0);

      // A rotation kills the old token at once.
      const rotated = await adminApi.rotateConsumerToken(reader.id);
      expect(rotated.status()).toBe(200);
      await expect(sse.connect('consumer', { headers: { authorization: `Bearer ${reader.token}` } })).rejects.toThrow(
        /401/,
      );

      // A delete kills it too.
      await expectStatus(await adminApi.deleteConsumer(reader.id), 200);
      await expect(sse.connect('consumer', { headers: { authorization: `Bearer ${reader.token}` } })).rejects.toThrow(
        /401/,
      );
    },
  );

  test(
    'the consumer list never carries a token or a hash (TC-STR-083)',
    {
      tag: [Tag.regression],
    },
    async ({ adminApi, consumer }) => {
      const reader = await consumer({ scope: { kinds: ['github'] } });
      const list = await adminApi.listConsumers();
      expect(list.status()).toBe(200);
      const body = await list.text();
      expect(body).not.toContain(reader.token);
      expect(body).not.toContain('tokenHash');
    },
  );
});
