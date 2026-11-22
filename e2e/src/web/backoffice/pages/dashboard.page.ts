import { expect } from '@playwright/test';
import { BasePage } from '@web/shared/base.page';

export class DashboardPage extends BasePage {
  protected readonly path = './#dashboard';

  readonly heading = this.page.getByRole('heading', { name: 'Dashboard', exact: true });

  async expectLoaded(): Promise<void> {
    await expect(this.heading).toBeVisible();
  }

  /** The rail shows the signed-in email only when the live API answered (the static preview shows a sample one). */
  signedInAs(email: string) {
    return this.page.getByText(email, { exact: true });
  }
}
