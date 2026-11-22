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

  /** The owner card of a GitHub integration, and its parts. */
  ownerCard(id: string) {
    return this.page.getByTestId(`owner-card-${id}`);
  }

  ownerType(id: string) {
    return this.page.getByTestId(`owner-type-${id}`);
  }

  ownerRepos(id: string) {
    return this.page.getByTestId(`owner-repos-${id}`);
  }

  ownerHealth(id: string) {
    return this.page.getByTestId(`owner-health-${id}`);
  }

  ownerOpen(id: string) {
    return this.page.getByTestId(`owner-open-${id}`);
  }

  /** The GitHub create form: pick the owner type, name the owner, submit. */
  readonly createOpen = this.page.getByTestId('gh-create-open');
  readonly createName = this.page.getByTestId('gh-owner-name');
  readonly createError = this.page.getByTestId('gh-owner-error');
  readonly createSubmit = this.page.getByTestId('gh-create-submit');

  async createGithub(ownerType: 'user' | 'organization', ownerName: string): Promise<void> {
    await this.createOpen.click();
    await this.page.getByTestId(`gh-owner-type-${ownerType}`).click();
    await this.createName.fill(ownerName);
    await this.createSubmit.click();
  }
}
