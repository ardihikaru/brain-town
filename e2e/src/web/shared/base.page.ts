import type { Page } from '@playwright/test';

/**
 * Base for every page object.
 *
 * Rules:
 * - One class per page/screen: src/web/<app>/pages/<name>.page.ts
 * - Expose locators as readonly fields and user intentions as methods (`login()`, `createProduct()`),
 *   never low-level steps (`clickButton3()`).
 * - Locator priority: getByRole > getByLabel > getByPlaceholder > getByText > getByTestId. No XPath, no CSS chains.
 * - Only "is this page ready?" assertions live here (`expectLoaded`); business assertions belong in specs.
 */
export abstract class BasePage {
  /** Path relative to the app's baseURL (configured per Playwright project). */
  protected abstract readonly path: string;

  constructor(protected readonly page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto(this.path);
    await this.expectLoaded();
  }

  abstract expectLoaded(): Promise<void>;
}
