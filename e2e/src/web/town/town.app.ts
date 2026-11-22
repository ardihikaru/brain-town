import type { Page } from '@playwright/test';
import { TownPage } from './pages/town.page';

/** Exposed to tests as the `town` fixture. */
export class TownApp {
  readonly home: TownPage;

  constructor(readonly page: Page) {
    this.home = new TownPage(page);
  }
}
