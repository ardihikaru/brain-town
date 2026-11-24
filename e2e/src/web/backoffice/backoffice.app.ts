import type { Page } from '@playwright/test';
import { DashboardPage } from './pages/dashboard.page';
import { EventsPage } from './pages/events.page';
import { GithubSetupPage } from './pages/github-setup.page';
import { IntegrationsPage } from './pages/integrations.page';
import { OwnerPage } from './pages/owner.page';
import { LoginPage } from './pages/login.page';
import { SettingsPage } from './pages/settings.page';
import { SetupPage } from './pages/setup.page';

/** Exposed to tests as the `backoffice` fixture. */
export class BackofficeApp {
  readonly login: LoginPage;
  readonly dashboard: DashboardPage;
  readonly integrations: IntegrationsPage;
  readonly setup: SetupPage;
  readonly events: EventsPage;
  readonly githubSetup: GithubSetupPage;
  readonly owner: OwnerPage;
  readonly settings: SettingsPage;

  constructor(readonly page: Page) {
    this.login = new LoginPage(page);
    this.dashboard = new DashboardPage(page);
    this.integrations = new IntegrationsPage(page);
    this.setup = new SetupPage(page);
    this.events = new EventsPage(page);
    this.githubSetup = new GithubSetupPage(page);
    this.owner = new OwnerPage(page);
    this.settings = new SettingsPage(page);
  }
}
