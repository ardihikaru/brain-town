import { expect } from '@playwright/test';
import { BasePage } from '@web/shared/base.page';

export class EventsPage extends BasePage {
  protected readonly path = './#events';

  readonly streamPill = this.page.getByText('stream connected');

  async expectLoaded(): Promise<void> {
    await expect(this.page.getByRole('heading', { name: 'Event log' })).toBeVisible();
  }

  /** Event log rows containing `text` (type, summary, integration name or delivery). */
  row(text: string) {
    return this.page.getByRole('row').filter({ hasText: text });
  }
}
