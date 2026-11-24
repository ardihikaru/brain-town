import { test, expect } from '@fixtures';
import { expectJson } from '@api/core/assertions';
import { CreatedIntegrationSchema, IntegrationSchema } from '@api/rest/admin/admin.schemas';
import { setupGithub } from '@api/rest/github/github.setup';
import { ANIMORA_AVAILABLE, ANIMORA_SKIP_REASON, setupAnimora } from '@api/stream/integrations/animora/animora.setup';
import { buildGithubScope } from '@data/factories/github.factory';
import { lockAnimoraProduct } from '@utils/shared-lock';
import { Tag } from '@utils/tags';
import { uniqueId } from '@utils/unique';

// Both sides, town view: the video the REAL Animora server publishes in its /feed.json (with its konsep name) is pulled
// by Brain Town and the platform room's Channels view shows the concept as live. Needs the Animora services in the stack.

const PULL_WAIT_MS = 20_000;

test.describe('town · animora both sides (real feed)', () => {
  test.skip(!ANIMORA_AVAILABLE, ANIMORA_SKIP_REASON);

  test(
    'the Channels view shows the concept of the video pulled from the real Animora feed (TC-TOWN-063)',
    { tag: [Tag.regression] },
    async ({ town, adminApi, sse, apiContextFor, cleanup }) => {
      // A parallel masking spec hides the shared product "animora"; that would turn this channel private.
      cleanup.add(await lockAnimoraProduct());
      const { seed } = await setupAnimora({ apiContextFor });
      const scope = buildGithubScope();
      await setupGithub(
        { apiContextFor, adminApi, cleanup },
        { org: scope.org, ownerType: scope.ownerType ?? 'organization' },
      );
      // A pull-only integration on its own org: the only events of this test come from the puller.
      const witness = await expectJson(
        await adminApi.createIntegration({ kind: 'animora', name: uniqueId('animora-witness'), org: uniqueId('org') }),
        CreatedIntegrationSchema,
        201,
      );
      cleanup.add(() => adminApi.deleteIntegration(witness.integration.id));
      const stream = await sse.connect('public');
      const feed = await town.home.gotoIsolated('Asia/Makassar');
      await town.home.expectVideoHydrated();

      await expectJson(
        await adminApi.updateIntegration(witness.integration.id, { feedUrl: seed.feedUrl }),
        IntegrationSchema,
      );
      feed.deliver(await stream.waitFor((e) => e.data.includes(seed.videos.public.feedId), PULL_WAIT_MS));

      await town.home.openPlatformChannels('youtube');
      const card = town.home.channelCard(seed.channel.title);
      await expect(card).toBeVisible();
      await expect(town.home.conceptRow(card, seed.concept.name)).toHaveAttribute('data-status', 'live');
    },
  );
});
