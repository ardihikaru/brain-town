import { test as setup } from '@fixtures';
import { expectJson } from '@api/core/assertions';
import { AdminClient } from '@api/rest/admin/admin.client';
import { LoginSchema, SessionSchema } from '@api/rest/admin/admin.schemas';
import { credentials, webApp } from '@config/targets';

const app = webApp('backoffice');

// Signs in through the admin API with the browser context's own request client, so the session cookie lands in
// the browser state. Signing in through the form is covered by tests/web/backoffice/login.spec.ts (TC-BO-001);
// keeping the setup on the API means a UI defect does not block every other back-office spec.
setup('authenticate backoffice', async ({ page }) => {
  const api = new AdminClient(page.request);

  await expectJson(await api.login(credentials.admin), LoginSchema);
  await expectJson(await api.session(), SessionSchema);

  await page.context().storageState({ path: app.storageState });
});
