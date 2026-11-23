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

  /** The "Animora" button of the add card (`#setup-new-animora`): creates the integration and opens its setup page. */
  async addAnimora(): Promise<void> {
    await this.page.getByTestId('int-add-animora').click();
  }

  /** The Animora group of the list, one card per integration, and the card's feed line. */
  readonly animoraGroup = this.page.getByTestId('igroup-animora');

  animoraCard(id: string) {
    return this.page.getByTestId(`animora-card-${id}`);
  }

  animoraCardFeed(id: string) {
    return this.page.getByTestId(`animora-card-feed-${id}`);
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

  /** The QA create form: a name (required) and an org (optional). */
  readonly qaCreateOpen = this.page.getByTestId('qa-create-open');
  readonly qaName = this.page.getByTestId('qa-name');
  readonly qaOrg = this.page.getByTestId('qa-org');
  readonly qaNameError = this.page.getByTestId('qa-name-error');
  readonly qaCreateSubmit = this.page.getByTestId('qa-create-submit');

  async createQa(name: string, org = ''): Promise<void> {
    await this.qaCreateOpen.click();
    await this.qaName.fill(name);
    await this.qaOrg.fill(org);
    await this.qaCreateSubmit.click();
  }

  /** A QA card, its org line and the shown name of any integration card (plain or owner card). */
  qaCard(id: string) {
    return this.page.getByTestId(`qa-card-${id}`);
  }

  qaCardOrg(id: string) {
    return this.page.getByTestId(`qa-card-org-${id}`);
  }

  name(id: string) {
    return this.page.getByTestId(`int-name-${id}`);
  }

  /** The "@login" shown on a GitHub owner card whose name was customised. */
  ownerLogin(id: string) {
    return this.page.getByTestId(`owner-login-${id}`);
  }

  /** The one inline rename editor (at most one is open anywhere). */
  readonly renameForm = this.page.getByTestId('int-rename-form');
  readonly renameInput = this.page.getByTestId('int-rename-input');
  readonly renameError = this.page.getByTestId('int-rename-error');

  /** Opens the editor on a card, types the new name and presses Enter, which saves. */
  async rename(id: string, name: string): Promise<void> {
    await this.page.getByTestId(`int-rename-${id}`).click();
    await this.renameInput.fill(name);
    await this.renameInput.press('Enter');
  }
}
