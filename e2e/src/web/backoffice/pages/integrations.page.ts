import { expect } from '@playwright/test';
import { BasePage } from '@web/shared/base.page';

const KIND_LABEL = { gaos: 'GAOS', qa: 'QA tool', site: 'mfardiansyah.id' } as const;

export class IntegrationsPage extends BasePage {
  protected readonly path = './#integrations';

  async expectLoaded(): Promise<void> {
    await expect(this.page.getByRole('heading', { name: 'Integrations', exact: true })).toBeVisible();
  }

  /** "Add an integration" card: one button per platform. Creates the integration and opens its setup page. */
  async add(kind: keyof typeof KIND_LABEL): Promise<void> {
    await this.page.getByRole('button', { name: KIND_LABEL[kind], exact: true }).click();
  }
}
