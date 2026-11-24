import { test, expect } from '@fixtures';
import { holdTimezone, saveTimezone } from '@api/rest/admin/timezone.setup';
import { skipUnlessDestructiveAllowed } from '@utils/guards';
import { Tag } from '@utils/tags';
import { zoneHms, zoneLabel, zoneOtherThan } from '@utils/zone';

// The header clock shows wall-clock time in the town's zone. The page's own clock is faked (Playwright page.clock) so
// the shown time is exact: install before load, then jump to a second boundary and run the page's aligned timer.

const START = new Date('2030-03-10T16:20:30Z');
const AT = new Date('2030-03-10T16:59:58Z');
const plus = (ms: number): Date => new Date(AT.getTime() + ms);

const labelled = [
  { zone: 'Asia/Jakarta', label: 'WIB' },
  { zone: 'Asia/Makassar', label: 'WITA' },
  { zone: 'Asia/Jayapura', label: 'WIT' },
  { zone: 'Asia/Tokyo', label: 'GMT+9' },
];

test.describe('town · header clock', () => {
  for (const { zone, label } of labelled) {
    test(
      `?tz=${zone} shows the zone's time with the label ${label} (TC-TOWN-050)`,
      { tag: [Tag.smoke] },
      async ({ town }) => {
        await town.home.installClock(START);
        await town.home.gotoInZone(zone);
        await expect(town.home.clock).toHaveAttribute('data-tz', zone);

        await town.home.pauseClockAt(AT);
        await town.home.tickClock(500);

        await expect(town.home.clock).toHaveText(`${zoneHms(zone, AT)} ${label}`);
      },
    );
  }

  test(
    'the clock ticks once a second on the second and rolls over the hour (TC-TOWN-051)',
    { tag: [Tag.regression] },
    async ({ town }) => {
      const zone = 'Asia/Makassar';
      await town.home.installClock(START);
      await town.home.gotoInZone(zone);
      await town.home.pauseClockAt(AT);
      await town.home.tickClock(500);
      await expect(town.home.clock).toHaveText(`${zoneHms(zone, AT)} WITA`);

      await town.home.tickClock(600);
      await expect(town.home.clock).toHaveText(`${zoneHms(zone, plus(1000))} WITA`);

      await town.home.tickClock(1000);
      await expect(town.home.clock).toHaveText(`${zoneHms(zone, plus(2000))} WITA`);
      expect(zoneHms(zone, plus(2000)).startsWith('01:00:00')).toBe(true);
    },
  );

  test(
    'the zone saved through the admin API drives the clock in live mode (TC-TOWN-052)',
    { tag: [Tag.smoke, Tag.destructive] },
    async ({ town, adminApi, cleanup }) => {
      skipUnlessDestructiveAllowed();
      const before = await holdTimezone(adminApi, cleanup);
      const zone = zoneOtherThan(before.timezone, 'Asia/Makassar', 'Asia/Jayapura');
      await saveTimezone(adminApi, before, zone);
      await town.home.installClock(START);

      await town.home.goto();
      await expect(town.home.mode).toHaveText('live SSE');
      await expect(town.home.clock).toHaveAttribute('data-tz', zone);
      await town.home.pauseClockAt(AT);
      await town.home.tickClock(500);

      await expect(town.home.clock).toHaveText(`${zoneHms(zone, AT)} ${zoneLabel(zone)}`);
    },
  );

  test(
    '?tz= wins over the zone in the admin settings (TC-TOWN-053)',
    { tag: [Tag.regression, Tag.destructive] },
    async ({ town, adminApi, cleanup }) => {
      skipUnlessDestructiveAllowed();
      const before = await holdTimezone(adminApi, cleanup);
      const stored = zoneOtherThan(before.timezone, 'Asia/Tokyo', 'UTC');
      await saveTimezone(adminApi, before, stored);

      await town.home.gotoInZone('Asia/Jayapura');
      await expect(town.home.mode).toHaveText('live SSE');

      await expect(town.home.clock).toHaveAttribute('data-tz', 'Asia/Jayapura');
      await expect(town.home.clock).toContainText('WIT');
    },
  );
});
