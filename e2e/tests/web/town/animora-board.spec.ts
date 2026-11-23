import { test, expect } from '@fixtures';
import { expectStatus } from '@api/core/assertions';
import { setupGithub } from '@api/rest/github/github.setup';
import {
  buildVideoParts,
  buildVideoPublished,
  buildVideoRendered,
  buildVideoScheduled,
} from '@data/factories/animora.factory';
import { buildGithubScope } from '@data/factories/github.factory';
import { Tag } from '@utils/tags';

// Arrange via API → act in the Video Generator and YouTube boards → assert on the cards. The page's own /events is
// replaced by a stream this test controls (gotoIsolated), so events pushed by parallel Animora specs cannot reach it:
// the empty states and the counts are deterministic.

test.describe('town · Animora video boards', () => {
  test(
    'the video and platform boards show an empty state until the first Animora event, then the video card (TC-TOWN-041)',
    { tag: [Tag.smoke] },
    async ({ town, ingestApi, integration, sse, apiContextFor, adminApi, cleanup }) => {
      const scope = buildGithubScope();
      await setupGithub(
        { apiContextFor, adminApi, cleanup },
        { org: scope.org, ownerType: scope.ownerType ?? 'organization' },
      );
      const animora = await integration('animora');
      const parts = buildVideoParts();
      const rendered = buildVideoRendered(parts);
      const stream = await sse.connect('public');
      const feed = await town.home.gotoIsolated();
      await expect.poll(async () => (await town.home.video()).source).toBe('live');

      await town.home.openVideoBoard();
      await expect(town.home.videoBoardEmpty).toBeVisible();
      await expect(town.home.videoBoardEmpty).toContainText('No videos yet.');
      await town.home.openPlatformBoard('youtube');
      await expect(town.home.platBoardEmpty).toBeVisible();
      await expect(town.home.platBoardEmpty).toContainText('Nothing from Animora yet.');

      await town.home.openVideoBoard();
      await expectStatus(await ingestApi.send(animora.ingestPath, rendered, { token: animora.token }), 202);
      feed.deliver(await stream.waitFor((e) => e.data.includes(rendered.id)));

      await expect(town.home.videoCards(parts.title)).toHaveCount(1);
      await expect(town.home.videoCards(parts.title)).toHaveAttribute('data-state', 'ready');
      await expect(town.home.videoBoardEmpty).toHaveCount(0);
    },
  );

  test(
    'a video rendered, scheduled and published on YouTube moves from a video card to a live YouTube card (TC-TOWN-042)',
    { tag: [Tag.smoke] },
    async ({ town, ingestApi, integration, sse, apiContextFor, adminApi, cleanup }) => {
      const scope = buildGithubScope();
      await setupGithub(
        { apiContextFor, adminApi, cleanup },
        { org: scope.org, ownerType: scope.ownerType ?? 'organization' },
      );
      const animora = await integration('animora');
      const parts = buildVideoParts({ vendor: 'youtube' });
      const stream = await sse.connect('public');
      const feed = await town.home.gotoIsolated();
      await expect.poll(async () => (await town.home.video()).source).toBe('live');
      const before = await town.home.video();
      const send = async (envelope: ReturnType<typeof buildVideoRendered>): Promise<void> => {
        await expectStatus(await ingestApi.send(animora.ingestPath, envelope, { token: animora.token }), 202);
        feed.deliver(await stream.waitFor((e) => e.data.includes(envelope.id)));
      };

      await send(buildVideoRendered(parts));
      await expect.poll(async () => (await town.home.video()).rendered).toBe(before.rendered + 1);
      await town.home.openVideoBoard();
      await expect(town.home.videoCards(parts.title)).toHaveAttribute('data-state', 'ready');

      await send(buildVideoScheduled(parts));
      await expect
        .poll(async () => (await town.home.video()).platforms['youtube']?.scheduled)
        .toBe((before.platforms['youtube']?.scheduled ?? 0) + 1);
      await expect(town.home.videoCards(parts.title)).toHaveAttribute('data-state', 'scheduled');
      await town.home.openPlatformBoard('youtube');
      await expect(town.home.platCards(parts.title)).toHaveAttribute('data-state', 'slot');

      await send(buildVideoPublished(parts));
      await expect
        .poll(async () => (await town.home.video()).platforms['youtube']?.live)
        .toBe((before.platforms['youtube']?.live ?? 0) + 1);
      await expect(town.home.platCards(parts.title)).toHaveCount(1);
      await expect(town.home.platCards(parts.title)).toHaveAttribute('data-state', 'live');
      await expect(town.home.platCards(parts.title)).toHaveAttribute('data-platform', 'youtube');
      await town.home.openVideoBoard();
      await expect(town.home.videoCards(parts.title)).toHaveCount(1);
      await expect(town.home.videoCards(parts.title)).toHaveAttribute('data-state', 'published');
    },
  );
});
