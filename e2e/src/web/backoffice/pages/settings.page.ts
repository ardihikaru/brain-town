import { expect } from '@playwright/test';
import { BasePage } from '@web/shared/base.page';

/** Settings (#prefs): the service card with retention, the town timezone and Save. */
export class SettingsPage extends BasePage {
  protected readonly path = './#prefs';

  readonly timezone = this.page.getByTestId('svc-timezone');
  readonly timezonePreview = this.page.getByTestId('svc-timezone-preview');
  readonly save = this.page.getByRole('button', { name: 'Save', exact: true });

  async expectLoaded(): Promise<void> {
    await expect(this.page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  }

  /** Fixes the page's Date before it loads, so "Now: HH:MM" is exact. Call before `goto`. */
  async freezeTime(time: Date): Promise<void> {
    await this.page.clock.setFixedTime(time);
  }

  async reload(): Promise<void> {
    await this.page.reload();
    await this.expectLoaded();
  }

  async chooseTimezone(zone: string): Promise<void> {
    await this.timezone.selectOption(zone);
  }
}
