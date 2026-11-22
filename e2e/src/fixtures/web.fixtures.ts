import { test as base } from '@playwright/test';
import { TownApp } from '@web/town/town.app';
import { BackofficeApp } from '@web/backoffice/backoffice.app';

/** One fixture per frontend app. Add a line here when you add src/web/<new-app>/. */
export interface WebFixtures {
  town: TownApp;
  backoffice: BackofficeApp;
}

export const webTest = base.extend<WebFixtures>({
  town: async ({ page }, use) => {
    await use(new TownApp(page));
  },
  backoffice: async ({ page }, use) => {
    await use(new BackofficeApp(page));
  },
});
