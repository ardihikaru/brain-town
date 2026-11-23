import { expect, type Locator } from '@playwright/test';
import { z } from 'zod';
import { BasePage } from '@web/shared/base.page';

const ValleySchema = z.object({
  source: z.enum(['sample', 'live']),
  owners: z.record(
    z.string(),
    z.object({
      type: z.enum(['', 'user', 'organization']),
      hidden: z.boolean(),
      placed: z.boolean(),
      halls: z.array(z.string()),
      over: z.number().int().nonnegative(),
      gate: z.union([z.literal(0), z.literal(1), z.literal(2), z.null()]).optional(),
    }),
  ),
  unowned: z.unknown().optional(),
});
export type Valley = z.infer<typeof ValleySchema>;

/** The town (/). It reads /events (SSE) live; `?sim=1` forces the built-in simulator. */
export class TownPage extends BasePage {
  protected readonly path = './';

  /** Connection pill: "connecting", "live SSE", "reconnecting" or "simulated". */
  readonly mode = this.page.getByTestId('town-mode');
  /** The "Live feed" list (newest first, max 60 lines). */
  readonly log = this.page.getByTestId('town-log');
  readonly logLines = this.log.getByRole('listitem');

  async expectLoaded(): Promise<void> {
    await expect(this.page.getByRole('heading', { name: 'Live feed' })).toBeVisible();
  }

  /**
   * Opens the QA Lab "Board" view through the town's own hook. The canvas has no accessible building list, so the
   * detail is opened with window.brainTown.openDetail(id, view).
   */
  async openQaBoard(): Promise<void> {
    const opened = await this.page.evaluate(() => {
      const town = (window as unknown as { brainTown: { openDetail(id: string, view: string): boolean } }).brainTown;
      return town.openDetail('qa', 'board');
    });
    expect(opened).toBe(true);
  }

  /** One QA tool group of the board, found by the tool name it was given. */
  qaGroup(tool: string) {
    return this.page.locator(`[data-testid="qa-group"][data-tool=${JSON.stringify(tool)}]`);
  }

  /** The run card of one spec inside a group. */
  qaCard(group: Locator, spec: string) {
    return group.getByTestId('qa-card').filter({ hasText: spec });
  }

  async gotoSimulated(): Promise<void> {
    await this.page.goto('./?sim=1');
    await this.expectLoaded();
  }

  /** The valley part of the read-only test hook `window.brainTown.snapshot()` (plain data, no titles). */
  async valley(): Promise<Valley> {
    const raw = await this.page.evaluate(() => {
      const hook = (window as unknown as { brainTown: { snapshot: () => { valley: unknown } } }).brainTown;
      return hook.snapshot().valley;
    });
    return ValleySchema.parse(raw);
  }

  /** The whole hook snapshot as text, to prove a name never reached the page's own state. */
  async snapshotText(): Promise<string> {
    return this.page.evaluate(() => {
      const hook = (window as unknown as { brainTown: { snapshot: () => unknown } }).brainTown;
      return JSON.stringify(hook.snapshot());
    });
  }
}
