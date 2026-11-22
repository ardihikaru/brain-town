import { expect } from '@playwright/test';
import { BasePage } from '@web/shared/base.page';

/** Setup page of one integration (#setup-<id>): ingest URL and the one-time token. */
export class SetupPage extends BasePage {
  protected readonly path = './#integrations';

  readonly ingestUrl = this.page.getByTestId('su-url');
  readonly token = this.page.getByTestId('su-sec');
  readonly revealToken = this.page.getByRole('button', { name: 'Show' });

  async expectLoaded(): Promise<void> {
    await expect(this.page.getByRole('heading', { name: 'Set it up' })).toBeVisible();
  }

  /** The integration id from the URL hash (#setup-<id>). */
  integrationId(): string {
    return new URL(this.page.url()).hash.replace(/^#setup-/, '');
  }
}
