import { test, expect } from '@fixtures';
import { expectError, expectJson, expectStatus } from '@api/core/assertions';
import { LoginSchema, SessionSchema } from '@api/rest/admin/admin.schemas';
import { AdminClient } from '@api/rest/admin/admin.client';
import { credentials } from '@config/targets';
import { Tag } from '@utils/tags';

// Login failures are capped at 10 per minute for the whole API: keep wrong-password cases to one per spec.

test.describe('admin · sign in', () => {
  test(
    'admin signs in and the session reports the email and mode (TC-ADM-001)',
    { tag: [Tag.smoke] },
    async ({ apiContextFor }) => {
      const api = new AdminClient(await apiContextFor('anonymous'));

      const login = await expectJson(await api.login(credentials.admin), LoginSchema);
      const session = await expectJson(await api.session(), SessionSchema);

      expect(login.email).toBe(credentials.admin.email);
      expect(session).toEqual({ email: credentials.admin.email, mode: 'e2e' });
    },
  );

  test(
    'a wrong password is refused (401) and gives no session (TC-ADM-002)',
    { tag: [Tag.regression] },
    async ({ anonymousAdminApi }) => {
      const login = await anonymousAdminApi.login({ email: credentials.admin.email, password: 'not-the-password' });

      await expectError(login, 401);
      expect(login.headers()['set-cookie']).toBeUndefined();
      await expectError(await anonymousAdminApi.session(), 401);
    },
  );

  test('signing out ends the session (TC-ADM-004)', { tag: [Tag.regression] }, async ({ apiContextFor }) => {
    const api = new AdminClient(await apiContextFor('anonymous'));
    await expectJson(await api.login(credentials.admin), LoginSchema);

    await expectStatus(await api.logout(), 204);

    await expectError(await api.session(), 401);
  });
});

test.describe('admin · session required', () => {
  const protectedCalls: { name: string; call: (api: AdminClient) => ReturnType<AdminClient['session']> }[] = [
    { name: 'GET /api/admin/session', call: (api) => api.session() },
    { name: 'GET /api/admin/integrations', call: (api) => api.listIntegrations() },
    { name: 'POST /api/admin/integrations', call: (api) => api.createIntegration({ kind: 'gaos', name: 'x' }) },
    { name: 'DELETE /api/admin/integrations/{id}', call: (api) => api.deleteIntegration('gaos-000000') },
    { name: 'POST /api/admin/integrations/{id}/token', call: (api) => api.rotateToken('gaos-000000') },
    { name: 'GET /api/admin/products', call: (api) => api.products() },
    { name: 'PUT /api/admin/products/{key}', call: (api) => api.putProduct('x', { visibility: 'hidden' }) },
    { name: 'GET /api/admin/events', call: (api) => api.events() },
    { name: 'PUT /api/admin/settings', call: (api) => api.putSettings({ retentionDays: 1, animation: false }) },
    { name: 'GET /api/admin/stats', call: (api) => api.stats() },
  ];

  for (const { name, call } of protectedCalls) {
    test(
      `${name} without a session is refused (401) (TC-ADM-003)`,
      { tag: [Tag.regression] },
      async ({ anonymousAdminApi }) => {
        await expectError(await call(anonymousAdminApi), 401);
      },
    );
  }
});

test.describe('admin · request format', () => {
  test('a mutation that is not JSON is refused (415) (TC-ADM-005)', { tag: [Tag.regression] }, async ({ adminApi }) => {
    const response = await adminApi.sendRaw('POST', '/api/admin/integrations', 'kind=gaos&name=x', 'text/plain');

    await expectError(response, 415);
  });

  test('a malformed JSON body is refused (400) (TC-ADM-006)', { tag: [Tag.regression] }, async ({ adminApi }) => {
    const response = await adminApi.sendRaw('POST', '/api/admin/integrations', '{"kind":', 'application/json');

    await expectError(response, 400);
  });
});
