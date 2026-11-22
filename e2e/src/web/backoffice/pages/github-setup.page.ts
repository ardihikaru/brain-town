import { expect } from '@playwright/test';
import { BasePage } from '@web/shared/base.page';

/**
 * Setup page of a GitHub integration (#setup-<id>): the webhook secret field and the event checklist.
 * Hooks are the data-testids of the GitHub setup page spec (§9).
 */
export class GithubSetupPage extends BasePage {
  protected readonly path = './#integrations';

  /** The secret input: empty until Show or Copy (the secret is not in the page before). */
  readonly secret = this.page.getByTestId('su-sec');
  readonly showSecret = this.page.getByTestId('su-sec-show');
  readonly copySecret = this.page.getByTestId('su-sec-copy');

  readonly checklist = this.page.getByTestId('gh-events');
  /** Shown only after a ping that lacks Issues or Pull requests; `data-missing` lists the ids. */
  readonly missingCallout = this.page.getByTestId('gh-missing');

  readonly popover = this.page.getByTestId('gh-pop');
  readonly popoverTitle = this.page.getByTestId('gh-pop-title');
  readonly popoverSends = this.page.getByTestId('gh-pop-sends');
  readonly popoverKeeps = this.page.getByTestId('gh-pop-keeps');
  readonly popoverTown = this.page.getByTestId('gh-pop-town');
  readonly popoverGroup = this.page.getByTestId('gh-pop-group');
  readonly popoverFigure = this.page.getByTestId('gh-pop-fig');

  async expectLoaded(): Promise<void> {
    await expect(this.page.getByRole('heading', { name: 'Set it up' })).toBeVisible();
  }

  /** Opens the setup page by hash, like SetupPage.open: the dashboard and the list both link to it, so no link click. */
  async open(id: string): Promise<void> {
    await this.page.goto(`./#setup-${id}`);
    await this.expectLoaded();
  }

  /** The chip of one GitHub event (`issues`, `pull_request`, `check_run`…); `data-state` carries its state. */
  chip(event: string) {
    return this.page.getByTestId(`gh-chip-${event}`);
  }

  async openDetails(event: string): Promise<void> {
    await this.chip(event).click();
  }

  async closeDetails(): Promise<void> {
    await this.page.keyboard.press('Escape');
  }

  /** What the clipboard holds now (the test grants clipboard-read first). */
  async clipboardText(): Promise<string> {
    return this.page.evaluate(() => navigator.clipboard.readText());
  }
}
