import { expect } from '@playwright/test';
import { BasePage } from '@web/shared/base.page';

/** The town (/). It reads /events (SSE) live; `?sim=1` forces the built-in simulator. */
export class TownPage extends BasePage {
  protected readonly path = './';

  /** Connection pill: "connecting", "live SSE", "reconnecting" or "simulated". */
  readonly mode = this.page.getByTestId('town-mode');
  /** The "Live feed" list (newest first, max 60 lines). */
  readonly log = this.page.getByTestId('town-log');
  readonly logLines = this.log.getByRole('listitem');

  async expectLoaded(): Promise<void> {
    await expect(this.page.getByRole('heading', { name: 'Live feed' })).toBeVisible();
  }

  async gotoSimulated(): Promise<void> {
    await this.page.goto('./?sim=1');
    await this.expectLoaded();
  }
}
