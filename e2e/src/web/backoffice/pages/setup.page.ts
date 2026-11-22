import { expect, type Dialog } from '@playwright/test';
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

  /** Clicks "Rotate and copy", confirms, and returns what landed on the clipboard. */
  async rotateAndCopy(): Promise<string> {
    await this.allowClipboard();
    this.armConfirm();
    await this.rotateButton.click();
    await this.confirmRotate();
    await expect(this.token).toBeVisible();
    return this.readClipboard();
  }

  /**
   * The confirmation step of "Rotate and copy", isolated here on purpose.
   * Currently a native confirm() dialog: it must be armed before the click, so it is called from
   * `rotateAndCopy()` through `armConfirm()`. Switch to an inline button here if the design changes.
   */
  private async confirmRotate(): Promise<void> {
    // Native dialog is accepted by the handler armed in armConfirm(); nothing more to do.
  }

  private armConfirm(): void {
    this.page.once('dialog', (dialog: Dialog) => void dialog.accept());
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
