import { expectJson } from '@api/core/assertions';
import { SettingsSchema, type Settings } from './admin.schemas';
import type { AdminClient } from './admin.client';
import { lockSettings } from '@utils/shared-lock';

/**
 * For a test that writes the shared timezone: takes the machine-wide settings lock (so no other project reads or
 * writes the zone meanwhile), remembers the current settings and registers cleanups that restore the zone and then
 * release the lock (cleanup runs in reverse order). Returns the settings found.
 */
export async function holdTimezone(
  adminApi: AdminClient,
  cleanup: { add: (fn: () => Promise<unknown>) => void },
): Promise<Settings> {
  const release = await lockSettings();
  cleanup.add(release);
  const before = await expectJson(await adminApi.getSettings(), SettingsSchema);
  cleanup.add(async () => {
    const now = await expectJson(await adminApi.getSettings(), SettingsSchema);
    return adminApi.putSettings({
      retentionDays: now.retentionDays,
      animation: now.animation,
      timezone: before.timezone,
    });
  });
  return before;
}

/** Saves a timezone and keeps the other settings as they are. */
export async function saveTimezone(adminApi: AdminClient, before: Settings, timezone: string): Promise<Settings> {
  return expectJson(
    await adminApi.putSettings({ retentionDays: before.retentionDays, animation: before.animation, timezone }),
    SettingsSchema,
  );
}
