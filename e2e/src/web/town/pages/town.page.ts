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

const PlatformSchema = z.object({
  scheduled: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  live: z.number().int().nonnegative(),
  published: z.number().int().nonnegative(),
  channels: z.number().int().nonnegative(),
});
const VideoSchema = z.object({
  source: z.enum(['sample', 'live']),
  hydrated: z.boolean().optional(),
  rendered: z.number().int().nonnegative(),
  platforms: z.record(z.string(), PlatformSchema),
});
export type Video = z.infer<typeof VideoSchema>;

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

  /**
   * The org label of the run columns inside a group, filtered by its text. Needs `data-testid="qa-card-org"` on the
   * `<i>` org label in `qaBoard()` (web/town/index.html); the label is a sibling of the card, so it is scoped to the group.
   */
  qaOrgLabel(group: Locator, text: string) {
    return group.getByTestId('qa-card-org').filter({ hasText: text });
  }

  /** The "no runs yet" empty state of the QA Lab board. */
  readonly qaBoardEmpty = this.page.getByTestId('qa-board-empty');

  /**
   * Opens the town with its /events stream replaced by one this test controls, so no event from a parallel test
   * can reach the page. The stream is empty (valid SSE, reconnecting every 100 ms) until `deliver` hands it frames (queued, all handed over on the next reconnect),
   * copied from the real public stream; /api/town stays the real one; returns once the page has switched from the sample town to the live one.
   */
  async gotoIsolated(zone?: string): Promise<{ deliver(frame: { id: string; event: string; data: string }): void }> {
    let pending = '';
    await this.page.route('**/events', async (route) => {
      const body = `retry: 100\n\n${pending}`;
      pending = '';
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body });
    });
    // The town also reads the last 100 Animora events once (`?replay=100&kind=animora`) to rebuild its video state after a
    // reload; that history would carry the events of parallel tests, so it is empty here too.
    await this.page.route('**/events?*replay=*', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'retry: 100\n\n' });
    });
    const snapshot = this.page.waitForResponse((r) => new URL(r.url()).pathname === '/api/town');
    await this.page.goto(zone ? `./?tz=${encodeURIComponent(zone)}` : this.path);
    await this.expectLoaded();
    expect((await snapshot).ok()).toBe(true);
    // The sample town (with its demo QA cards) is swapped for the live one once the snapshot is bound.
    await expect.poll(async () => (await this.valley()).source).toBe('live');
    return {
      deliver: (f) => {
        pending += `id: ${f.id}\nevent: ${f.event}\ndata: ${f.data}\n\n`;
      },
    };
  }

  /** The Video Generator "Board" (rendered, scheduled, published) through the town's own hook. */
  async openVideoBoard(): Promise<void> {
    await this.openDetail('yt', 'queues');
  }

  /** The upload-room "Board" of one platform company. */
  async openPlatformBoard(platform: 'youtube' | 'facebook' | 'instagram' | 'tiktok'): Promise<void> {
    await this.openDetail('plat', 'board', platform);
  }

  private async openDetail(id: string, view: string, sub?: string): Promise<void> {
    const opened = await this.page.evaluate(
      ([i, v, s]) => {
        const town = (
          window as unknown as { brainTown: { openDetail(id: string, view: string, sub?: string): boolean } }
        ).brainTown;
        return town.openDetail(i as string, v as string, s ?? undefined);
      },
      [id, view, sub ?? null],
    );
    expect(opened).toBe(true);
  }

  readonly videoBoardEmpty = this.page.getByTestId('video-board-empty');
  readonly platBoardEmpty = this.page.getByTestId('plat-board-empty');

  /** Video cards of the Video Generator board, found by the title they carry. */
  videoCards(title: string) {
    return this.page.getByTestId('video-card').filter({ hasText: title });
  }

  /** Platform cards (upload room board), found by the title they carry. */
  platCards(title: string) {
    return this.page.getByTestId('plat-card').filter({ hasText: title });
  }

  /** The Animora part of the hook snapshot: counts only, no titles. */
  async video(): Promise<Video> {
    const raw = await this.page.evaluate(() => {
      const hook = (window as unknown as { brainTown: { snapshot: () => { video: unknown } } }).brainTown;
      return hook.snapshot().video;
    });
    return VideoSchema.parse(raw);
  }

  /** The header clock: `data-tz` is the zone, the text is "HH:MM:SS <label>". */
  readonly clock = this.page.getByTestId('town-clock');

  /** Opens the town with the zone forced by `?tz=` (it then wins over the zone in GET /api/town). */
  async gotoInZone(zone: string): Promise<void> {
    await this.page.goto(`./?tz=${encodeURIComponent(zone)}`);
    await this.expectLoaded();
  }

  /** Starts the page's fake clock at `time` before the first navigation; time keeps flowing until `pauseClockAt`. */
  async installClock(time: Date): Promise<void> {
    await this.page.clock.install({ time });
  }

  /** Jumps the fake clock to `time` and stops it: timers (the header tick) only run on `tickClock`. */
  async pauseClockAt(time: Date): Promise<void> {
    await this.page.clock.pauseAt(time);
  }

  /** Runs the page's timers for `ms` of fake time. */
  async tickClock(ms: number): Promise<void> {
    await this.page.clock.runFor(ms);
  }

  /** The Channels view of one platform room (tabs People, Channels, Board). */
  async openPlatformChannels(platform: 'youtube' | 'facebook' | 'instagram' | 'tiktok'): Promise<void> {
    await this.openDetail('plat', 'channels', platform);
  }

  readonly channelsEmpty = this.page.getByTestId('plat-channels-empty');
  /** The "times in <label>" legend (the room intro and the Channels view each carry one; they always agree). */
  readonly tzLegend = this.page.getByTestId('plat-tz-legend');
  /** The whole page text, to prove a masked name is nowhere on it. */
  readonly body = this.page.locator('body');

  /** One channel card of the Channels view, found by the channel name. */
  channelCard(channel: string) {
    return this.page.locator(`[data-testid="plat-channel"][data-channel=${JSON.stringify(channel)}]`);
  }

  /** The private channel card (every hidden channel shares it). */
  readonly privateChannelCard = this.page.locator('[data-testid="plat-channel"][data-private="true"]');

  /** One concept row inside a channel card. */
  conceptRow(card: Locator, concept: string) {
    return card.locator(`[data-testid="plat-concept"][data-concept=${JSON.stringify(concept)}]`);
  }

  /** Every concept row inside a channel card. */
  conceptRows(card: Locator) {
    return card.getByTestId('plat-concept');
  }

  /** The waiting-list item of a card with the given slot (epoch ms). */
  queueItemAt(card: Locator, slotMs: number) {
    return this.queueItems(card).and(this.page.locator(`[data-slot="${slotMs}"]`));
  }

  /** Slot, concept and title of the waiting-list items of a card, in the order shown. */
  async queueOrder(card: Locator): Promise<{ slot: number; concept: string | null; title: string }[]> {
    return this.queueItems(card).evaluateAll((items) =>
      items.map((el) => ({
        slot: Number((el as HTMLElement).dataset['slot']),
        concept: (el as HTMLElement).dataset['concept'] ?? null,
        title: el.querySelector('.t')?.textContent ?? '',
      })),
    );
  }

  /** The waiting-list items of a channel card, in the order shown. */
  queueItems(card: Locator) {
    return card.getByTestId('plat-channel-queue').getByTestId('plat-queue-item');
  }

  /** Waits until the live video state exists and the silent history replay has been applied. */
  async expectVideoHydrated(): Promise<void> {
    await expect.poll(async () => (await this.video()).hydrated).toBe(true);
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
