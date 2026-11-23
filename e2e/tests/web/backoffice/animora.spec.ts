import { test, expect } from '@fixtures';
import { expectJson } from '@api/core/assertions';
import { IntegrationListSchema } from '@api/rest/admin/admin.schemas';
import { uniqueId } from '@utils/unique';
import { Tag } from '@utils/tags';

// Arrange via API (or the add card) → act in the Animora cards and setup page → assert in the page and via the API.
// Integrations created through the add card are registered for cleanup as soon as their id is in the URL.

const DEFAULT_NAME = /^Animora( \d+)?$/;

test.describe('backoffice · Animora integrations', () => {
  test(
    'the Animora add button creates an integration and opens its setup page with the env blocks and no token (TC-BO-062)',
    { tag: [Tag.smoke] },
    async ({ backoffice, page, adminApi, cleanup }) => {
      await backoffice.integrations.goto();

      await backoffice.integrations.addAnimora();

      await backoffice.setup.waitForCreated('animora');
      const id = backoffice.setup.integrationId();
      cleanup.add(() => adminApi.deleteIntegration(id));
      await expect(page).toHaveURL(new RegExp(`#setup-${id}$`));
      const token = await backoffice.setup.token.inputValue();
      const env = backoffice.setup.animoraEnv;
      await expect(env).toContainText('ANIMORA_NV_BRAIN_TOWN_ENABLED=true');
      await expect(env).toContainText('ANIMORA_NV_BRAIN_TOWN_URL=');
      await expect(env).toContainText(`/ingest/animora/${id}`);
      await expect(env).toContainText('ANIMORA_NV_BRAIN_TOWN_TOKEN=<paste token>');
      await expect(env).toContainText('ANIMORA_BRAIN_TOWN_ENABLED=true');
      await expect(env).toContainText('ANIMORA_BRAIN_TOWN_TOKEN=<paste token>');
      expect(await env.innerText()).not.toContain(token);
      const list = await expectJson(await adminApi.listIntegrations(), IntegrationListSchema);
      expect(list.find((i) => i.id === id)).toMatchObject({ kind: 'animora' });
    },
  );

  test(
    'a second Animora integration gets a numbered default name (TC-BO-063)',
    { tag: [Tag.regression] },
    async ({ backoffice, adminApi, cleanup }) => {
      await backoffice.integrations.goto();
      await backoffice.integrations.addAnimora();
      await backoffice.setup.waitForCreated('animora');
      const first = backoffice.setup.integrationId();
      cleanup.add(() => adminApi.deleteIntegration(first));
      await backoffice.integrations.goto();

      await backoffice.integrations.addAnimora();

      await backoffice.setup.waitForCreated('animora');
      const second = backoffice.setup.integrationId();
      cleanup.add(() => adminApi.deleteIntegration(second));
      expect(second).not.toBe(first);
      await expect(backoffice.setup.title).toHaveText(DEFAULT_NAME);
      await expect(backoffice.setup.title).not.toHaveText(/^Animora$/);
      const list = await expectJson(await adminApi.listIntegrations(), IntegrationListSchema);
      const names = [first, second].map((id) => list.find((i) => i.id === id)?.name ?? '');
      expect(names[0]).toMatch(DEFAULT_NAME);
      expect(names[1]).toMatch(/^Animora \d+$/);
      expect(names[1]).not.toBe(names[0]);
    },
  );

  test(
    'the Animora group lists a card per integration with its feed line (TC-BO-064)',
    { tag: [Tag.regression] },
    async ({ backoffice, adminApi, integration }) => {
      const pushOnly = await integration('animora', { name: uniqueId('Animora Push') });
      const pulled = await integration('animora', { name: uniqueId('Animora Pull') });
      await adminApi.updateIntegration(pulled.id, { feedUrl: 'https://animora.example.test/feed.json' });

      await backoffice.integrations.goto();

      await expect(backoffice.integrations.animoraGroup).toBeVisible();
      await expect(backoffice.integrations.animoraCard(pushOnly.id)).toBeVisible();
      await expect(backoffice.integrations.name(pushOnly.id)).toHaveText(pushOnly.integration.name);
      await expect(backoffice.integrations.animoraCardFeed(pushOnly.id)).toHaveText('Push only');
      await expect(backoffice.integrations.animoraCardFeed(pulled.id)).toHaveText('Feed pulled every 5 min');
    },
  );

  test(
    'an Animora card is renamed from the card (TC-BO-065)',
    { tag: [Tag.regression] },
    async ({ backoffice, adminApi, integration }) => {
      const animora = await integration('animora', { name: uniqueId('Animora Before') });
      const renamed = uniqueId('Animora After');
      await backoffice.integrations.goto();
      await expect(backoffice.integrations.name(animora.id)).toHaveText(animora.integration.name);

      await backoffice.integrations.rename(animora.id, renamed);

      await expect(backoffice.integrations.name(animora.id)).toHaveText(renamed);
      const list = await expectJson(await adminApi.listIntegrations(), IntegrationListSchema);
      expect(list.find((i) => i.id === animora.id)?.name).toBe(renamed);
    },
  );

  test(
    'an Animora integration is renamed from its setup page (TC-BO-066)',
    { tag: [Tag.regression] },
    async ({ backoffice, adminApi, integration }) => {
      const animora = await integration('animora', { name: uniqueId('Animora Before') });
      const renamed = uniqueId('Animora After');
      await backoffice.integrations.goto();
      await backoffice.setup.open(animora.id);

      await backoffice.setup.rename(renamed);

      await expect(backoffice.setup.title).toHaveText(renamed);
      await expect(backoffice.setup.renameForm).toBeHidden();
      const list = await expectJson(await adminApi.listIntegrations(), IntegrationListSchema);
      expect(list.find((i) => i.id === animora.id)?.name).toBe(renamed);
    },
  );

  test(
    'an http:// feed URL shows the inline error and is not saved (TC-BO-067)',
    { tag: [Tag.regression] },
    async ({ backoffice, adminApi, integration }) => {
      const animora = await integration('animora');
      await backoffice.integrations.goto();
      await backoffice.setup.open(animora.id);

      await backoffice.setup.saveFeed('http://animora.example.test/feed.json');

      await expect(backoffice.setup.feedError).toBeVisible();
      await expect(backoffice.setup.feedError).toContainText('https://');
      const list = await expectJson(await adminApi.listIntegrations(), IntegrationListSchema);
      expect(list.find((i) => i.id === animora.id)?.feedUrl ?? '').toBe('');
    },
  );

  test(
    'an https:// feed URL is saved, survives a reload and shows on the card; an empty one clears it (TC-BO-068)',
    { tag: [Tag.smoke] },
    async ({ backoffice, page, adminApi, integration }) => {
      const animora = await integration('animora');
      const feedUrl = `https://${uniqueId('animora').toLowerCase()}.example.test/feed.json`;
      await backoffice.integrations.goto();
      await backoffice.setup.open(animora.id);

      await backoffice.setup.saveFeed(feedUrl);

      await expect(backoffice.setup.feedError).toBeHidden();
      await expect
        .poll(async () => {
          const list = await expectJson(await adminApi.listIntegrations(), IntegrationListSchema);
          return list.find((i) => i.id === animora.id)?.feedUrl;
        })
        .toBe(feedUrl);
      await page.reload();
      await backoffice.setup.expectLoaded();
      await expect(backoffice.setup.feed).toHaveValue(feedUrl);
      await backoffice.integrations.goto();
      await expect(backoffice.integrations.animoraCardFeed(animora.id)).toHaveText('Feed pulled every 5 min');

      await backoffice.setup.open(animora.id);
      await backoffice.setup.saveFeed('');

      await expect(backoffice.setup.feedError).toBeHidden();
      await expect
        .poll(async () => {
          const list = await expectJson(await adminApi.listIntegrations(), IntegrationListSchema);
          return list.find((i) => i.id === animora.id)?.feedUrl ?? '';
        })
        .toBe('');
      await backoffice.integrations.goto();
      await expect(backoffice.integrations.animoraCardFeed(animora.id)).toHaveText('Push only');
    },
  );
});
