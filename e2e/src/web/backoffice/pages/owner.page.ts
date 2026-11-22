import { expect } from '@playwright/test';
import { BasePage } from '@web/shared/base.page';

/**
 * Owner page of a GitHub integration (#integration-<id>): its repositories, each with visibility, alias and
 * subscribed events, and the "add a repo" panel. Hooks are the data-testids agreed with the frontend.
 */
export class OwnerPage extends BasePage {
  protected readonly path = './#integrations';

  readonly root = this.page.getByTestId('owner-page');
  readonly title = this.page.getByTestId('owner-title');
  readonly type = this.page.getByTestId('owner-type');
  readonly repos = this.page.getByTestId('owner-repos');

  readonly addRepoPanel = this.page.getByTestId('add-repo-panel');
  readonly addRepoNames = this.page.getByTestId('add-repo-names');
  readonly addRepoScript = this.page.getByTestId('add-repo-script');
  readonly showSecret = this.page.getByTestId('own-sec-show');

  async expectLoaded(): Promise<void> {
    await expect(this.root).toBeVisible();
  }

  /** Opens the owner page by hash, like SetupPage.open. */
  async open(id: string): Promise<void> {
    await this.page.goto(`./#integration-${id}`);
    await this.expectLoaded();
  }

  row(repo: string) {
    return this.page.getByTestId(`repo-row-${repo}`);
  }

  visibilityButton(repo: string, state: 'public' | 'hidden') {
    return this.page.getByTestId(`repo-vis-${repo}-${state}`);
  }

  alias(repo: string) {
    return this.page.getByTestId(`repo-alias-${repo}`);
  }

  events(repo: string) {
    return this.page.getByTestId(`repo-events-${repo}`);
  }

  /** Types a new alias and leaves the field (Enter blurs it, which saves). */
  async setAlias(repo: string, alias: string): Promise<void> {
    const field = this.alias(repo);
    await field.fill(alias);
    await field.press('Enter');
  }

  async typeRepoNames(names: string): Promise<void> {
    await this.addRepoNames.fill(names);
  }

  /** The generated command as text, whether the page renders it in a textarea or a block. */
  async scriptText(): Promise<string> {
    return this.addRepoScript.evaluate((el) => ('value' in el ? String(el.value) : (el.textContent ?? '')));
  }
}
