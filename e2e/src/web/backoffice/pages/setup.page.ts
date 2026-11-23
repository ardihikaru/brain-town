import { expect } from '@playwright/test';
import { BasePage } from '@web/shared/base.page';

/** Geometry of one cell of the event map, in CSS pixels (viewport coordinates). */
export interface EventMapCell {
  row: number;
  col: number;
  text: string;
  box: { left: number; right: number; top: number; bottom: number };
  scrollWidth: number;
  clientWidth: number;
  /** Bounding rect of a Range around everything the cell contains. */
  content: { left: number; right: number; top: number; bottom: number };
}

/** Table and event-map region geometry, in CSS pixels (viewport coordinates). */
export interface EventMapLayout {
  /** Region content box: its rect minus border and padding. */
  region: { left: number; right: number; top: number; bottom: number };
  regionClientWidth: number;
  table: { left: number; right: number; top: number; bottom: number };
  tableScrollWidth: number;
}

/** Setup page of one integration (#setup-<id>): ingest URL and the one-time token. */
export class SetupPage extends BasePage {
  protected readonly path = './#integrations';

  readonly ingestUrl = this.page.getByTestId('su-url');
  /** The token input. Only present while the plaintext is in memory (just created or just rotated). */
  readonly token = this.page.getByTestId('su-sec');
  readonly showToken = this.page.getByTestId('su-sec-show');
  readonly copyButton = this.page.getByTestId('su-sec-copy');
  /** Shown instead of the token input when the plaintext is gone ("Hidden. Shown once when created."). */
  readonly hiddenNote = this.page.getByTestId('su-sec-hidden');
  readonly rotateButton = this.page.getByTestId('su-sec-rotate');
  /** The inline confirm that replaces the hidden row after "Rotate and copy" is clicked. */
  readonly rotateConfirm = this.page.getByTestId('su-sec-rotate-confirm');
  readonly rotateCancel = this.page.getByTestId('su-sec-rotate-cancel');
  readonly rotateWarning = this.page.getByText('The current secret stops working right away.');
  /** Any element showing a mask; the page must never render one. */
  readonly maskedText = this.page.getByText('••••');
  /** Kept for existing specs. */
  readonly revealToken = this.page.getByRole('button', { name: 'Show' });

  /** The Animora env blocks (naskah-to-video and server) and the optional public feed field. */
  readonly animoraEnv = this.page.getByTestId('su-animora-env');
  readonly feed = this.page.getByTestId('su-feed');
  readonly feedSave = this.page.getByTestId('su-feed-save');
  readonly feedError = this.page.getByTestId('su-feed-error');

  async saveFeed(url: string): Promise<void> {
    await this.feed.fill(url);
    await this.feedSave.click();
  }

  /** The page title and its rename editor (the same editor as on a card). */
  readonly title = this.page.getByTestId('setup-title');
  readonly renameButton = this.page.getByTestId('su-rename');
  readonly renameForm = this.page.getByTestId('int-rename-form');
  readonly renameInput = this.page.getByTestId('int-rename-input');

  async rename(name: string): Promise<void> {
    await this.renameButton.click();
    await this.renameInput.fill(name);
    await this.renameInput.press('Enter');
  }

  /** The "What becomes what" panel and its table (kind -> town event). */
  readonly eventMap = this.page.getByRole('region', { name: 'What becomes what' });
  readonly eventMapTable = this.eventMap.getByRole('table');

  /** Measures every body and header cell of the event map (no assertions). */
  async measureEventMapCells(): Promise<EventMapCell[]> {
    return this.eventMapTable.locator('tr').evaluateAll((rows) =>
      rows.flatMap((tr, row) =>
        Array.from(tr.children).map((cell, col) => {
          const b = cell.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(cell);
          const c = range.getBoundingClientRect();
          return {
            row,
            col,
            text: (cell.textContent ?? '').trim(),
            box: { left: b.left, right: b.right, top: b.top, bottom: b.bottom },
            scrollWidth: cell.scrollWidth,
            clientWidth: cell.clientWidth,
            content: { left: c.left, right: c.right, top: c.top, bottom: c.bottom },
          };
        }),
      ),
    );
  }

  /** Measures the event-map region's content box and the table inside it (no assertions). */
  async measureEventMapLayout(): Promise<EventMapLayout> {
    const table = await this.eventMapTable.evaluate((el) => {
      const b = el.getBoundingClientRect();
      return {
        box: { left: b.left, right: b.right, top: b.top, bottom: b.bottom },
        scrollWidth: el.scrollWidth,
      };
    });
    const region = await this.eventMap.evaluate((el) => {
      const b = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      const px = (v: string): number => parseFloat(v) || 0;
      return {
        box: {
          left: b.left + px(s.borderLeftWidth) + px(s.paddingLeft),
          right: b.right - px(s.borderRightWidth) - px(s.paddingRight),
          top: b.top + px(s.borderTopWidth) + px(s.paddingTop),
          bottom: b.bottom - px(s.borderBottomWidth) - px(s.paddingBottom),
        },
        clientWidth: el.clientWidth,
      };
    });
    return {
      region: region.box,
      regionClientWidth: region.clientWidth,
      table: table.box,
      tableScrollWidth: table.scrollWidth,
    };
  }

  async expectLoaded(): Promise<void> {
    await expect(this.page.getByRole('heading', { name: 'Set it up' })).toBeVisible();
  }

  /** Opens the setup page of an existing integration directly (no plaintext token in memory). */
  async open(id: string): Promise<void> {
    await this.page.goto(`./#setup-${id}`);
    await this.expectLoaded();
  }

  /**
   * Waits for the page of a freshly created integration. In live mode the hash first reads #setup-new-<kind> and is
   * replaced by #setup-<kind>-<hex> once the create request returns; the token is only usable after that.
   */
  async waitForCreated(kind: string): Promise<void> {
    await expect(this.page).toHaveURL(new RegExp(`#setup-${kind}-[0-9a-f]{6}$`));
    await this.expectLoaded();
    await expect(this.token).not.toHaveValue('');
  }

  /** The integration id from the URL hash (#setup-<id>). */
  integrationId(): string {
    return new URL(this.page.url()).hash.replace(/^#setup-/, '');
  }

  /** Clicks Copy and returns what landed on the clipboard. */
  async copySecret(): Promise<string> {
    await this.allowClipboard();
    await this.copyButton.click();
    return this.readClipboard();
  }

  /** Clicks "Rotate and copy", confirms inline, and returns what landed on the clipboard. */
  async rotateAndCopy(): Promise<string> {
    await this.allowClipboard();
    await this.rotateButton.click();
    await this.confirmRotate();
    await expect(this.token).toBeVisible();
    return this.readClipboard();
  }

  /** The confirmation step of "Rotate and copy" ("Rotate now"), isolated so a design change touches one place. */
  private async confirmRotate(): Promise<void> {
    await this.rotateConfirm.click();
  }

  private async allowClipboard(): Promise<void> {
    const { origin } = new URL(this.page.url());
    await this.page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  }

  /** Polls until the clipboard has text (the copy is async), then returns it. */
  async readClipboard(): Promise<string> {
    let text = '';
    await expect
      .poll(async () => {
        text = await this.page.evaluate(() => navigator.clipboard.readText());
        return text;
      })
      .not.toBe('');
    return text;
  }
}
