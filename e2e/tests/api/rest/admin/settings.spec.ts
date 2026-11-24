import { test, expect } from '@fixtures';
import { expectJson } from '@api/core/assertions';
import { SettingsSchema, StatsSchema } from '@api/rest/admin/admin.schemas';
import { skipUnlessDestructiveAllowed } from '@utils/guards';
import { Tag } from '@utils/tags';

// Settings are one shared record. Tests that change it are @destructive, restore the value they found,
// and assert on the PUT response only, so a parallel test changing settings cannot make them flaky.

test.describe('admin · settings and stats', () => {
  test('settings are readable (TC-ADM-050)', { tag: [Tag.smoke] }, async ({ adminApi }) => {
    const settings = await expectJson(await adminApi.getSettings(), SettingsSchema);

    expect(settings.retentionDays).toBeGreaterThanOrEqual(1);
    expect(settings.retentionDays).toBeLessThanOrEqual(3650);
  });

  test(
    'retention and animation can be changed (TC-ADM-050)',
    { tag: [Tag.regression, Tag.destructive] },
    async ({ adminApi, cleanup }) => {
      skipUnlessDestructiveAllowed();
      const before = await expectJson(await adminApi.getSettings(), SettingsSchema);
      cleanup.add(() => adminApi.putSettings({ retentionDays: before.retentionDays, animation: before.animation }));

      const saved = await expectJson(
        await adminApi.putSettings({ retentionDays: 7, animation: false }),
        SettingsSchema,
      );

      expect(saved).toMatchObject({ retentionDays: 7, animation: false });
    },
  );

  const bounds = [
    { sent: 0, stored: 1 },
    { sent: 1, stored: 1 },
    { sent: 3650, stored: 3650 },
    { sent: 3651, stored: 3650 },
  ];
  for (const { sent, stored } of bounds) {
    test(
      `retentionDays ${sent} is stored as ${stored} (1 to 3650) (TC-ADM-051)`,
      {
        tag: [Tag.regression, Tag.destructive],
      },
      async ({ adminApi, cleanup }) => {
        skipUnlessDestructiveAllowed();
        const before = await expectJson(await adminApi.getSettings(), SettingsSchema);
        cleanup.add(() => adminApi.putSettings({ retentionDays: before.retentionDays, animation: before.animation }));

        const saved = await expectJson(
          await adminApi.putSettings({ retentionDays: sent, animation: true }),
          SettingsSchema,
        );

        expect(saved.retentionDays).toBe(stored);
      },
    );
  }

  test(
    'stats count integrations, orgs, products and events (TC-ADM-052)',
    { tag: [Tag.regression] },
    async ({ adminApi, integration }) => {
      await integration('site');

      const stats = await expectJson(await adminApi.stats(), StatsSchema);

      expect(stats.Integrations).toBeGreaterThanOrEqual(1);
      expect(stats.Rejected).toBeLessThanOrEqual(stats.Events);
    },
  );
});
