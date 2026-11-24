import { test, expect } from '@fixtures';
import { expectError, expectJson } from '@api/core/assertions';
import { SettingsSchema } from '@api/rest/admin/admin.schemas';
import { holdTimezone } from '@api/rest/admin/timezone.setup';
import { TownClient } from '@api/rest/town/town.client';
import { TownSnapshotSchema } from '@api/rest/town/town.schemas';
import { skipUnlessDestructiveAllowed } from '@utils/guards';
import { Tag } from '@utils/tags';

// The timezone is part of the one shared settings record, and these tests read it back after writing it, so they run
// serially in one worker, hold the machine-wide settings lock (holdTimezone) against the web specs that write the zone, and every other spec leaves the timezone out of its writes (an omitted timezone keeps the
// current one). Each test restores the zone it found.

test.describe.configure({ mode: 'serial' });

/** A valid zone different from `current`, so a save is visible. */
function zoneOtherThan(current: string): string {
  return current === 'Asia/Tokyo' ? 'UTC' : 'Asia/Tokyo';
}

test.describe('admin · settings timezone', () => {
  test('settings carry an IANA timezone (TC-ADM-100)', { tag: [Tag.smoke, Tag.destructive] }, async ({ adminApi }) => {
    skipUnlessDestructiveAllowed();

    const settings = await expectJson(await adminApi.getSettings(), SettingsSchema);

    // The default is Asia/Jakarta; a zone another run left behind is still a valid name.
    expect(() => new Intl.DateTimeFormat('en', { timeZone: settings.timezone })).not.toThrow();
  });

  for (const zone of ['Asia/Tokyo', 'UTC']) {
    test(
      `a valid timezone ${zone} is saved and read back (TC-ADM-101)`,
      { tag: [Tag.regression, Tag.destructive] },
      async ({ adminApi, cleanup }) => {
        skipUnlessDestructiveAllowed();
        const before = await holdTimezone(adminApi, cleanup);

        const saved = await expectJson(
          await adminApi.putSettings({
            retentionDays: before.retentionDays,
            animation: before.animation,
            timezone: zone,
          }),
          SettingsSchema,
        );
        const read = await expectJson(await adminApi.getSettings(), SettingsSchema);

        expect(saved.timezone).toBe(zone);
        expect(read.timezone).toBe(zone);
      },
    );
  }

  for (const zone of ['Mars/Olympus', 'Local']) {
    test(
      `an invalid timezone ${zone} is refused (422) and the old one is kept (TC-ADM-102)`,
      { tag: [Tag.regression, Tag.destructive] },
      async ({ adminApi, cleanup }) => {
        skipUnlessDestructiveAllowed();
        const before = await holdTimezone(adminApi, cleanup);

        const error = await expectError(
          await adminApi.putSettings({
            retentionDays: before.retentionDays,
            animation: before.animation,
            timezone: zone,
          }),
          422,
        );
        const read = await expectJson(await adminApi.getSettings(), SettingsSchema);

        expect(error.error).toContain('timezone');
        expect(read.timezone).toBe(before.timezone);
      },
    );
  }

  test(
    'a save without timezone keeps the current one (TC-ADM-103)',
    { tag: [Tag.regression, Tag.destructive] },
    async ({ adminApi, cleanup }) => {
      skipUnlessDestructiveAllowed();
      const before = await holdTimezone(adminApi, cleanup);
      const zone = zoneOtherThan(before.timezone);
      await expectJson(
        await adminApi.putSettings({
          retentionDays: before.retentionDays,
          animation: before.animation,
          timezone: zone,
        }),
        SettingsSchema,
      );

      const saved = await expectJson(
        await adminApi.putSettings({ retentionDays: before.retentionDays, animation: !before.animation }),
        SettingsSchema,
      );

      expect(saved).toMatchObject({ timezone: zone, animation: !before.animation });
    },
  );

  test(
    'GET /api/town reports the configured timezone, also without a session (TC-STR-054)',
    { tag: [Tag.smoke, Tag.destructive] },
    async ({ adminApi, apiContextFor, cleanup }) => {
      skipUnlessDestructiveAllowed();
      const before = await holdTimezone(adminApi, cleanup);
      const zone = zoneOtherThan(before.timezone);
      await expectJson(
        await adminApi.putSettings({
          retentionDays: before.retentionDays,
          animation: before.animation,
          timezone: zone,
        }),
        SettingsSchema,
      );
      const town = new TownClient(await apiContextFor('anonymous'));

      const snapshot = await expectJson(await town.snapshot(), TownSnapshotSchema);

      expect(snapshot.timezone).toBe(zone);
    },
  );
});
