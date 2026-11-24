import { test, expect } from '@fixtures';
import { expectJson } from '@api/core/assertions';
import { SettingsSchema } from '@api/rest/admin/admin.schemas';
import { holdTimezone, saveTimezone } from '@api/rest/admin/timezone.setup';
import { skipUnlessDestructiveAllowed } from '@utils/guards';
import { Tag } from '@utils/tags';
import { zoneHm, zoneLabel, zoneOtherThan } from '@utils/zone';

// Settings → "Timezone": the select loads the stored zone, the preview shows the time there, Save keeps it. The zone is
// one shared record, so each test holds the settings lock and restores what it found. The page's Date is fixed so the
// preview is exact.

const NOW = new Date('2030-06-15T12:34:56Z');

test.describe('backoffice · settings timezone', () => {
  test(
    'the select loads the stored zone and the preview shows the time there (TC-BO-070)',
    { tag: [Tag.smoke, Tag.destructive] },
    async ({ backoffice, adminApi, cleanup }) => {
      skipUnlessDestructiveAllowed();
      const before = await holdTimezone(adminApi, cleanup);
      const zone = zoneOtherThan(before.timezone, 'Asia/Jayapura', 'Asia/Makassar');
      await saveTimezone(adminApi, before, zone);
      await backoffice.settings.freezeTime(NOW);

      await backoffice.settings.goto();

      await expect(backoffice.settings.timezone).toHaveValue(zone);
      await expect(backoffice.settings.timezonePreview).toHaveText(`Now: ${zoneHm(zone, NOW)} ${zoneLabel(zone, NOW)}`);
    },
  );

  test(
    'a changed zone updates the preview, is saved, and survives a reload (TC-BO-071)',
    { tag: [Tag.smoke, Tag.destructive] },
    async ({ backoffice, adminApi, cleanup }) => {
      skipUnlessDestructiveAllowed();
      const before = await holdTimezone(adminApi, cleanup);
      const zone = zoneOtherThan(before.timezone, 'Asia/Tokyo', 'Asia/Makassar');
      await backoffice.settings.freezeTime(NOW);
      await backoffice.settings.goto();
      await expect(backoffice.settings.timezone).toHaveValue(before.timezone);

      await backoffice.settings.chooseTimezone(zone);
      await expect(backoffice.settings.timezonePreview).toHaveText(`Now: ${zoneHm(zone, NOW)} ${zoneLabel(zone, NOW)}`);
      await backoffice.settings.save.click();

      await expect
        .poll(async () => (await expectJson(await adminApi.getSettings(), SettingsSchema)).timezone)
        .toBe(zone);
      await backoffice.settings.reload();
      await expect(backoffice.settings.timezone).toHaveValue(zone);
      await expect(backoffice.settings.timezonePreview).toHaveText(`Now: ${zoneHm(zone, NOW)} ${zoneLabel(zone, NOW)}`);
    },
  );
});
