import { test, expect } from '@fixtures';
import { expectStatus } from '@api/core/assertions';
import { TOKEN_PATTERN } from '@api/rest/admin/admin.schemas';
import { buildGaosTask } from '@data/factories/gaos.factory';
import { Tag } from '@utils/tags';

// The setup page shows the plaintext token only while it is in memory. Afterwards it must never offer a mask to copy.

test.describe('backoffice · one-time secret', () => {
  test(
    'copying right after creating gives the real token, never the mask (TC-BO-011)',
    { tag: [Tag.regression] },
    async ({ backoffice, ingestApi, adminApi, cleanup }) => {
      await backoffice.integrations.goto();
      await backoffice.integrations.add('gaos');
      await backoffice.setup.expectLoaded();
      const id = backoffice.setup.integrationId();
      cleanup.add(() => adminApi.deleteIntegration(id));
      await expect(backoffice.setup.token).toHaveValue(TOKEN_PATTERN);
      const shown = await backoffice.setup.token.inputValue();

      const copied = await backoffice.setup.copySecret();

      expect(copied).toBe(shown);
      expect(copied).toMatch(TOKEN_PATTERN);
      expect(copied).not.toContain('•');
      await expectStatus(await ingestApi.send(`/ingest/gaos/${id}`, buildGaosTask(), { token: copied }), 202);
    },
  );

  test(
    'revisiting a setup page shows the hidden state and no copyable mask (TC-BO-012)',
    { tag: [Tag.smoke] },
    async ({ backoffice, integration }) => {
      const gaos = await integration('gaos');

      await backoffice.setup.open(gaos.id);

      await expect(backoffice.setup.hiddenNote).toContainText('Hidden. Shown once when created.');
      await expect(backoffice.setup.rotateButton).toBeVisible();
      await expect(backoffice.setup.token).toHaveCount(0);
      await expect(backoffice.setup.copyButton).toHaveCount(0);
      await expect(backoffice.setup.maskedText).toHaveCount(0);

      await test.step('a reload keeps it hidden', async () => {
        await backoffice.page.reload();
        await backoffice.setup.expectLoaded();
        await expect(backoffice.setup.hiddenNote).toBeVisible();
        await expect(backoffice.setup.token).toHaveCount(0);
      });
    },
  );

  test(
    'Rotate and copy gives a working new token and the old one is refused (TC-BO-013)',
    { tag: [Tag.smoke] },
    async ({ backoffice, ingestApi, integration }) => {
      const gaos = await integration('gaos');
      await expectStatus(await ingestApi.send(gaos.ingestPath, buildGaosTask(), { token: gaos.token }), 202);
      await backoffice.setup.open(gaos.id);

      const copied = await backoffice.setup.rotateAndCopy();

      expect(copied).toMatch(TOKEN_PATTERN);
      expect(copied).not.toContain('•');
      expect(copied).not.toBe(gaos.token);
      await expect(backoffice.setup.token).toHaveValue(copied);
      await expectStatus(await ingestApi.send(gaos.ingestPath, buildGaosTask(), { token: gaos.token }), 401);
      await expectStatus(await ingestApi.send(gaos.ingestPath, buildGaosTask(), { token: copied }), 202);
    },
  );

  test(
    'Cancel on the rotate confirm restores the hidden state and keeps the old token working (TC-BO-014)',
    { tag: [Tag.regression] },
    async ({ backoffice, ingestApi, integration }) => {
      const gaos = await integration('gaos');
      await backoffice.setup.open(gaos.id);

      await backoffice.setup.rotateButton.click();
      await expect(backoffice.setup.rotateWarning).toBeVisible();
      await expect(backoffice.setup.rotateConfirm).toBeVisible();
      await backoffice.setup.rotateCancel.click();

      await expect(backoffice.setup.hiddenNote).toBeVisible();
      await expect(backoffice.setup.rotateButton).toBeVisible();
      await expect(backoffice.setup.rotateConfirm).toHaveCount(0);
      await expect(backoffice.setup.token).toHaveCount(0);
      await expectStatus(await ingestApi.send(gaos.ingestPath, buildGaosTask(), { token: gaos.token }), 202);
    },
  );
});
