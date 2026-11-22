import { test, expect } from '@fixtures';
import { expectStatus } from '@api/core/assertions';
import { credentials } from '@config/targets';
import { buildGaosTask } from '@data/factories/gaos.factory';
import { KnownBug } from '@utils/known-bugs';
import { Tag } from '@utils/tags';

test.describe('backoffice · sign in', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test(
    'the admin signs in through the form and sees the live dashboard while a GAOS product exists (TC-BO-001, TC-BO-003)',
    {
      tag: [Tag.smoke],
    },
    async ({ backoffice, ingestApi, integration }) => {
      test.fail(true, KnownBug.backofficeProductWithoutOrg);
      const gaos = await integration('gaos');
      await expectStatus(await ingestApi.send(gaos.ingestPath, buildGaosTask(), { token: gaos.token }), 202);
      await backoffice.login.goto();

      await backoffice.login.login(credentials.admin);

      await backoffice.dashboard.expectLoaded();
      await expect(backoffice.dashboard.signedInAs(credentials.admin.email)).toBeVisible();
    },
  );

  test(
    'a wrong password shows an error and keeps the gate closed (TC-BO-002)',
    { tag: [Tag.regression] },
    async ({ backoffice }) => {
      await backoffice.login.goto();

      await backoffice.login.login({ email: credentials.admin.email, password: 'not-the-password' });

      await expect(backoffice.login.toast).toHaveText('email or password is wrong');
      await expect(backoffice.login.submit).toBeVisible();
      await expect(backoffice.dashboard.heading).toBeHidden();
    },
  );
});
