import { expect } from '@playwright/test';
import { BasePage } from '@web/shared/base.page';

export class LoginPage extends BasePage {
  protected readonly path = './';

  // Scoped to the login form: the Settings page has another "Email" field (hidden until signed in).
  private readonly form = this.page.getByTestId('login-form');
  readonly email = this.form.getByLabel('Email');
  readonly password = this.form.getByLabel('Password');
  readonly submit = this.form.getByRole('button', { name: 'Sign in' });
  /** Toast messages (role=status). */
  readonly toast = this.page.getByRole('status');

  async expectLoaded(): Promise<void> {
    await expect(this.page.getByRole('heading', { name: 'Brain Town back-office' })).toBeVisible();
  }

  async login(credentials: { email: string; password: string }): Promise<void> {
    await this.email.fill(credentials.email);
    await this.password.fill(credentials.password);
    await this.submit.click();
  }
}
