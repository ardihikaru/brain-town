import { expect } from '@playwright/test';
import { BasePage } from '@web/shared/base.page';

/** Setup page of one integration (#setup-<id>): ingest URL and the one-time token. */
export class SetupPage extends BasePage {
  protected readonly path = './#integrations';

  readonly ingestUrl = this.page.getByTestId('su-url');
  /** The token input. Only present while the plaintext is in memory (just created or just rotated). */
  readonly token = this.page.getByTestId('su-sec');
  readonly showToken = this.page.getByTestId('su-sec-show');
  readonly copyButton = this.page.getByTestId('su-sec-copy');
  /** Shown instead of the token input when the plaintext is gone ("Hidden. Shown once when created."). */
  readonly hiddenNote = this.page.getByTestId('su-sec-hidden');
  readonly rotateButton = this.page.getByTestId('su-sec-rotate');
  /** The inline confirm that replaces the hidden row after "Rotate and copy" is clicked. */
  readonly rotateConfirm = this.page.getByTestId('su-sec-rotate-confirm');
  readonly rotateCancel = this.page.getByTestId('su-sec-rotate-cancel');
  readonly rotateWarning = this.page.getByText('The current secret stops working right away.');
  /** Any element showing a mask; the page must never render one. */
  readonly maskedText = this.page.getByText('••••');
  /** Kept for existing specs. */
  readonly revealToken = this.page.getByRole('button', { name: 'Show' });

  async expectLoaded(): Promise<void> {
    await expect(this.page.getByRole('heading', { name: 'Set it up' })).toBeVisible();
  }

  /** Opens the setup page of an existing integration directly (no plaintext token in memory). */
  async open(id: string): Promise<void> {
    await this.page.goto(`./#setup-${id}`);
    await this.expectLoaded();
  }

  /**
   * Waits for the page of a freshly created integration. In live mode the hash first reads #setup-new-<kind> and is
   * replaced by #setup-<kind>-<hex> once the create request returns; the token is only usable after that.
   */
  async waitForCreated(kind: string): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(`#setup-${kind}-[0-9a-f]{6}$`));
    await this.expectLoaded();
    await expect(this.token).not.toHaveValue('');
  }

  /** The integration id from the URL hash (#setup-<id>). */
  integrationId(): string {
    return new URL(this.page.url()).hash.replace(/^#setup-/, '');
  }

  /** Clicks Copy and returns what landed on the clipboard. */
  async copySecret(): Promise<string> {
    await this.allowClipboard();
    await this.copyButton.click();
    return this.readClipboard();
  }

  /** Clicks "Rotate and copy", confirms inline, and returns what landed on the clipboard. */
  async rotateAndCopy(): Promise<string> {
    await this.allowClipboard();
    await this.rotateButton.click();
    await this.confirmRotate();
    await expect(this.token).toBeVisible();
    return this.readClipboard();
  }

  /** The confirmation step of "Rotate and copy" ("Rotate now"), isolated so a design change touches one place. */
  private async confirmRotate(): Promise<void> {
    await this.rotateConfirm.click();
  }

  private async allowClipboard(): Promise<void> {
    const { origin } = new URL(this.page.url());
    await this.page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  }

  /** Polls until the clipboard has text (the copy is async), then returns it. */
  async readClipboard(): Promise<string> {
    let text = '';
    await expect
      .poll(async () => {
        text = await this.page.evaluate(() => navigator.clipboard.readText());
        return text;
      })
      .not.toBe('');
    return text;
  }
}
