import fs from 'node:fs';
import path from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import { z } from 'zod';
import { env } from '@config/env';
import { expectJson } from '@api/core/assertions';
import type { AdminClient } from '@api/rest/admin/admin.client';
import { AdminEventListSchema, AdminEventSchema, type AdminEvent } from '@api/rest/admin/admin.schemas';
import type { SseConnection } from '@api/stream/events/events.client';
import { SiteClient, SiteWebClient, type SiteNoteInput } from './site.client';
import { SEEDED_NOTE_SLUG } from '@data/factories/note.factory';
import { SeededNoteSchema, SitePostSchema, VisitLooseSchema, type SitePost } from './site.schemas';

/**
 * scripts/stack.sh writes this file when the mfardiansyah.id services started (it holds the two stack-owned Brain Town
 * "site" integrations, ids only: the tokens live only in the site containers' env files).
 */
const INTEGRATIONS_FILE = path.resolve(__dirname, '..', '..', '..', '..', '..', '.stack', 'site', 'integrations.json');

const IntegrationsFileSchema = z.object({ push: z.object({ id: z.string() }), pull: z.object({ id: z.string() }) });

function loadIntegrations(): z.infer<typeof IntegrationsFileSchema> | undefined {
  if (!fs.existsSync(INTEGRATIONS_FILE)) return undefined;
  return IntegrationsFileSchema.parse(JSON.parse(fs.readFileSync(INTEGRATIONS_FILE, 'utf8')));
}

const integrations = loadIntegrations();

/** False when the stack was started without the site repo (stack.sh warned). The site specs skip then. */
export const SITE_AVAILABLE = integrations !== undefined;
export const SITE_SKIP_REASON =
  'the mfardiansyah.id services are not part of this stack: stack.sh did not find the site repo (set SITE_REPO_DIR / SITE_REF)';

type Cleanup = { add: (task: () => Promise<unknown>) => void };

export interface SiteTarget {
  /** The site api whose pushes go to the stack-owned "push" integration (it has no feedUrl). */
  readonly push: SiteClient;
  /** The site api whose pushes go to the "pull" integration, which also pulls this instance's real /feed.json. */
  readonly pull: SiteClient;
  /** The site api that cannot reach Brain Town (connection refused). */
  readonly offline: SiteClient;
  /** The site's real nginx web image (/office). */
  readonly web: SiteWebClient;
  /** Ids of the two stack-owned Brain Town integrations. */
  readonly ids: { readonly push: string; readonly pull: string };
  /** The pull instance's feed URL as the Brain Town api container reaches it (https front, throwaway CA). */
  readonly pullFeedUrl: string;
}

/** Clients for the four site services. The integrations are owned by the stack, not by a test, so nothing to delete. */
export async function setupSite({
  apiContextFor,
}: {
  apiContextFor: (role: 'admin' | 'anonymous') => Promise<APIRequestContext>;
  cleanup: Cleanup;
}): Promise<SiteTarget> {
  if (!integrations || !env.SITE_ADMIN_PASSWORD) throw new Error(SITE_SKIP_REASON);
  const request = await apiContextFor('anonymous');
  const admin = { user: env.SITE_ADMIN_USER, password: env.SITE_ADMIN_PASSWORD };
  return {
    push: new SiteClient(request, env.SITE_API_URL, admin),
    pull: new SiteClient(request, env.SITE_PULL_API_URL, admin),
    offline: new SiteClient(request, env.SITE_OFFLINE_API_URL, admin),
    web: new SiteWebClient(request, env.SITE_WEB_URL),
    ids: { push: integrations.push.id, pull: integrations.pull.id },
    pullFeedUrl: env.SITE_PULL_FEED_URL_INTERNAL,
  };
}

/** Creates a note through the site admin API (expects 201) and registers its removal. */
export async function publishNote(
  site: SiteClient,
  note: SiteNoteInput,
  cleanup: Cleanup,
  expectedStatus = 201,
): Promise<SitePost> {
  const response = await site.createNote(note);
  cleanup.add(async () => {
    await site.deleteNote(note.slug);
    await site.deleteNote(note.slug, { purge: true });
  });
  return expectJson(response, SitePostSchema, expectedStatus);
}

/** Waits once (bounded, default 10 s) for the `article.published` push of `note` on `integration`. Never re-saves. */
export async function awaitPush(stream: SseConnection, note: SiteNoteInput, integration: string): Promise<AdminEvent> {
  return stream.waitForJson(AdminEventSchema, (e) => e.integration === integration && e.id === `post-${note.slug}`);
}

/** The seeded note visits are paid on (see SEEDED_NOTE_SLUG): its slug and the title a blog visit reports. */
export async function seededNote(site: SiteClient): Promise<{ slug: string; title: string }> {
  const note = await expectJson(await site.getNote(SEEDED_NOTE_SLUG), SeededNoteSchema);
  return { slug: note.slug, title: note.title };
}

/** Every stored delivery of one integration (newest first, at most 500), optionally narrowed by type or delivery. */
export async function integrationEvents(
  adminApi: AdminClient,
  integration: string,
  query: { type?: string; delivery?: 'ok' | 'rejected' } = {},
): Promise<AdminEvent[]> {
  return expectJson(await adminApi.events({ integration, limit: 500, ...query }), AdminEventListSchema);
}

/** The `site.visit` deliveries of `integration` for one visitor country (optionally one page) on the admin stream so far. */
export function visitsSeen(
  stream: SseConnection,
  integration: string,
  country: string,
  page?: 'home' | 'blog',
): AdminEvent[] {
  return stream
    .jsonEvents(AdminEventSchema)
    .filter((e) => isVisitOf(e, integration, country) && (page === undefined || pageOf(e) === page));
}

/** Waits (bounded, default 10 s) for the visit of `country` on the given page (home or blog). */
export async function waitForVisit(
  stream: SseConnection,
  integration: string,
  country: string,
  page: 'home' | 'blog',
): Promise<AdminEvent> {
  return stream.waitForJson(AdminEventSchema, (e) => isVisitOf(e, integration, country) && pageOf(e) === page);
}

function pageOf(e: AdminEvent): string | undefined {
  const raw = VisitLooseSchema.safeParse(e.raw);
  return raw.success ? raw.data.data.page : undefined;
}

function isVisitOf(e: AdminEvent, integration: string, country: string): boolean {
  const raw = VisitLooseSchema.safeParse(e.raw);
  return e.integration === integration && raw.success && raw.data.data.country === country;
}
