import { test, expect } from '@fixtures';
import { expectJson, expectStatus } from '@api/core/assertions';
import { setupGithub } from '@api/rest/github/github.setup';
import { buildGithubScope } from '@data/factories/github.factory';
import { OrgSchema } from '@api/rest/admin/admin.schemas';
import {
  buildVideoParts,
  buildVideoPublished,
  buildVideoRendered,
  buildVideoScheduledAt,
  type AnimoraEnvelope,
} from '@data/factories/animora.factory';
import { skipUnlessDestructiveAllowed } from '@utils/guards';
import { lockAnimoraProduct } from '@utils/shared-lock';
import { Tag } from '@utils/tags';
import { uniqueId } from '@utils/unique';

// The platform room's Channels view: one card per channel with its concepts today and its waiting list in slot order.
// The zone is forced with ?tz= so the legend and the day boundary do not depend on the shared timezone setting. Events
// come through an /events stream this test controls (gotoIsolated), because the room keeps at most six waiting tickets
// per platform: events of parallel tests would evict this test's tickets from the real stream.
// Slots are minutes from now: the "scheduled today" status holds unless the test runs within minutes of midnight in
// the chosen zone.

const ZONE = 'Asia/Makassar';
const MINUTE = 60_000;

function dueAt(offsetMs: number): { iso: string; ms: number } {
  const ms = Math.floor((Date.now() + offsetMs) / 1000) * 1000;
  return { iso: new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z'), ms };
}

function withConcept(envelope: AnimoraEnvelope, concept: string): AnimoraEnvelope {
  return { ...envelope, data: { ...envelope.data, concept } };
}

// The town only switches from its sample valley to the live one once a real GitHub owner exists, which the isolated
// stream needs; every test brings its own.
async function ownGithubOwner(ctx: Parameters<typeof setupGithub>[0]): Promise<void> {
  const scope = buildGithubScope();
  await setupGithub(ctx, { org: scope.org, ownerType: scope.ownerType ?? 'organization' });
}

test.describe('town · platform channels view', () => {
  test(
    'a channel card shows its concepts by status and its waiting list in slot order (TC-TOWN-060)',
    { tag: [Tag.smoke] },
    async ({ town, ingestApi, integration, sse, apiContextFor, adminApi, cleanup }) => {
      // A parallel masking spec hides the shared product "animora"; that would turn this channel private.
      cleanup.add(await lockAnimoraProduct());
      await ownGithubOwner({ apiContextFor, adminApi, cleanup });
      // Its own org: another spec may hide the default one.
      const animora = await integration('animora', { org: uniqueId('org') });
      const channelCode = uniqueId('kc');
      const channel = `Kanal ${channelCode}`;
      const concepts = {
        scheduled: uniqueId('Seri-S'),
        none: uniqueId('Seri-N'),
        made: uniqueId('Seri-M'),
        live: uniqueId('Seri-L'),
      };
      const part = () => buildVideoParts({ channel, channelCode });
      const stream = await sse.connect('public');
      const feed = await town.home.gotoIsolated(ZONE);
      await town.home.expectVideoHydrated();
      const send = async (envelope: AnimoraEnvelope): Promise<void> => {
        await expectStatus(await ingestApi.send(animora.ingestPath, envelope, { token: animora.token }), 202);
        feed.deliver(await stream.waitFor((e) => e.data.includes(envelope.id)));
      };
      const late = dueAt(3 * MINUTE);
      const early = dueAt(1 * MINUTE);
      const tomorrow = dueAt(26 * 60 * MINUTE);
      const lateParts = part();
      const earlyParts = part();
      const tomorrowParts = part();

      // Out of order on purpose: the later slot first.
      await send(buildVideoScheduledAt(lateParts, late.iso, concepts.scheduled));
      await send(buildVideoScheduledAt(tomorrowParts, tomorrow.iso, concepts.none));
      await send(buildVideoScheduledAt(earlyParts, early.iso, concepts.scheduled));
      await send(withConcept(buildVideoRendered(part()), concepts.made));
      await send(withConcept(buildVideoPublished(part()), concepts.live));

      await town.home.openPlatformChannels('youtube');
      const card = town.home.channelCard(channel);
      await expect(card).toBeVisible();
      await expect(town.home.conceptRow(card, concepts.scheduled)).toHaveAttribute('data-status', 'scheduled');
      await expect(town.home.conceptRow(card, concepts.none)).toHaveAttribute('data-status', 'none');
      await expect(town.home.conceptRow(card, concepts.made)).toHaveAttribute('data-status', 'made');
      await expect(town.home.conceptRow(card, concepts.live)).toHaveAttribute('data-status', 'live');
      await expect
        .poll(() => town.home.queueOrder(card))
        .toEqual([
          { slot: early.ms, concept: concepts.scheduled, title: earlyParts.title },
          { slot: late.ms, concept: concepts.scheduled, title: lateParts.title },
          { slot: tomorrow.ms, concept: concepts.none, title: tomorrowParts.title },
        ]);
    },
  );

  test(
    'the Channels view says which zone its times are in (TC-TOWN-061)',
    { tag: [Tag.regression] },
    async ({ town }) => {
      await town.home.gotoInZone(ZONE);
      await expect(town.home.mode).toHaveText('live SSE');
      await town.home.expectVideoHydrated();

      await town.home.openPlatformChannels('youtube');

      await expect(town.home.tzLegend).toHaveText('times in WITA');
    },
  );

  test(
    'a hidden product shows a private channel card without title, channel or concept (TC-TOWN-062)',
    { tag: [Tag.regression, Tag.destructive] },
    async ({ town, adminApi, ingestApi, integration, sse, apiContextFor, cleanup }) => {
      skipUnlessDestructiveAllowed();
      await ownGithubOwner({ apiContextFor, adminApi, cleanup });
      const org = uniqueId('org');
      const animora = await integration('animora', { org });
      const parts = buildVideoParts();
      const concept = uniqueId('Seri-H');
      const slot = dueAt(2 * MINUTE);
      await expectStatus(await ingestApi.send(animora.ingestPath, buildVideoRendered(), { token: animora.token }), 202);
      cleanup.add(() => adminApi.putOrg(org, { visibility: 'public' }));
      await expectJson(await adminApi.putOrg(org, { visibility: 'hidden', alias: uniqueId('Studio') }), OrgSchema);
      const stream = await sse.connect('public');
      const feed = await town.home.gotoIsolated(ZONE);
      await town.home.expectVideoHydrated();
      const scheduled = buildVideoScheduledAt(parts, slot.iso, concept);

      await expectStatus(await ingestApi.send(animora.ingestPath, scheduled, { token: animora.token }), 202);
      feed.deliver(await stream.waitFor((e) => e.data.includes(scheduled.id)));

      await town.home.openPlatformChannels('youtube');
      await expect(town.home.privateChannelCard).toBeVisible();
      const item = town.home.queueItemAt(town.home.privateChannelCard, slot.ms);
      await expect(item).toContainText('Private video');
      await expect(town.home.conceptRows(town.home.privateChannelCard)).toHaveCount(0);
      for (const secret of [parts.title, parts.channel, concept]) {
        await expect(town.home.body).not.toContainText(secret);
      }
    },
  );
});
