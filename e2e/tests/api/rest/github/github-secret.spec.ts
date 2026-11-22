import { test, expect } from '@fixtures';
import { expectError, expectJson } from '@api/core/assertions';
import { IntegrationListSchema } from '@api/rest/admin/admin.schemas';
import {
  CreatedGithubIntegrationSchema,
  GithubAcceptedSchema,
  RevealedSecretSchema,
  RotatedSecretSchema,
} from '@api/rest/github/github.schemas';
import { setupGithub } from '@api/rest/github/github.setup';
import { buildGithubScope, buildIssuesEvent } from '@data/factories/github.factory';
import { uniqueId } from '@utils/unique';
import { Tag } from '@utils/tags';

test.describe('admin · github webhook secret', () => {
  test(
    'creating a GitHub integration returns a whsec_ secret and the payload path (TC-ADM-060)',
    { tag: [Tag.smoke] },
    async ({ adminApi, cleanup }) => {
      const created = await expectJson(
        await adminApi.createIntegration({ kind: 'github', name: uniqueId('github') }),
        CreatedGithubIntegrationSchema,
        201,
      );
      cleanup.add(() => adminApi.deleteIntegration(created.integration.id));

      expect(created.integration.kind).toBe('github');
      expect(created.integration.events).toEqual([]);
      expect(created.ingestPath).toBe(`/ingest/github/${created.integration.id}`);
      expect(created.integration.tokenHint).toBe(created.token.slice(-4));
    },
  );

  test(
    'the secret can be revealed again and it is the one that signs deliveries (TC-ADM-061)',
    { tag: [Tag.smoke] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup });

      const revealed = await expectJson(await adminApi.getSecret(target.id), RevealedSecretSchema);

      expect(revealed.secret).toBe(target.secret);
      const response = await github.send(target.ingestPath, 'issues', buildIssuesEvent(buildGithubScope(), 'opened'), {
        secret: revealed.secret,
        delivery: uniqueId('delivery'),
      });
      await expectJson(response, GithubAcceptedSchema, 202);
    },
  );

  test(
    'revealing the secret of a GAOS integration is refused (404) (TC-ADM-062)',
    { tag: [Tag.regression] },
    async ({ adminApi, integration }) => {
      const gaos = await integration('gaos');

      await expectError(await adminApi.getSecret(gaos.id), 404);
    },
  );

  test(
    'revealing the secret needs an admin session (401) (TC-ADM-063)',
    { tag: [Tag.smoke] },
    async ({ apiContextFor, adminApi, anonymousAdminApi, cleanup }) => {
      const { target } = await setupGithub({ apiContextFor, adminApi, cleanup });

      await expectError(await anonymousAdminApi.getSecret(target.id), 401);
    },
  );

  test(
    'rotating makes the old secret fail (401) and the new one pass (TC-ADM-064)',
    { tag: [Tag.smoke] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const { github, target } = await setupGithub({ apiContextFor, adminApi, cleanup });
      const body = buildIssuesEvent(buildGithubScope(), 'opened');

      const rotated = await expectJson(await adminApi.rotateToken(target.id), RotatedSecretSchema);

      expect(rotated.token).not.toBe(target.secret);

      await test.step('the old secret is refused', async () => {
        const response = await github.send(target.ingestPath, 'issues', body, {
          secret: target.secret,
          delivery: uniqueId('delivery'),
        });
        await expectError(response, 401);
      });

      await test.step('the new secret is accepted and is what reveal returns', async () => {
        const response = await github.send(target.ingestPath, 'issues', body, {
          secret: rotated.token,
          delivery: uniqueId('delivery'),
        });
        await expectJson(response, GithubAcceptedSchema, 202);
        const revealed = await expectJson(await adminApi.getSecret(target.id), RevealedSecretSchema);
        expect(revealed.secret).toBe(rotated.token);
      });
    },
  );

  test(
    'the integration list never carries the secret (TC-ADM-065)',
    { tag: [Tag.smoke] },
    async ({ apiContextFor, adminApi, cleanup }) => {
      const { target } = await setupGithub({ apiContextFor, adminApi, cleanup });

      const response = await adminApi.listIntegrations();

      await expectJson(response, IntegrationListSchema);
      expect(await response.text()).not.toContain(target.secret);
    },
  );
});
