import type { SiteNoteInput } from '@api/stream/integrations/mfardiansyah-id/site.client';
import { uniqueId } from '@utils/unique';

export interface NoteOptions {
  /** `id` builds an Indonesian note (not in the feed, not pushed). Default `en`. */
  locale?: 'en' | 'id';
  /** Publish this many seconds from now instead of now: the note is scheduled and goes live later. */
  liveInSeconds?: number;
  title?: string;
}

/**
 * A live English note every site database has from its seed (backend/db/seed.json). Visit specs open it instead of
 * publishing a note of their own: each publish is one more push into the "push" integration, whose ingest budget
 * (INGEST_RATE / INGEST_BURST, low in the e2e stack) is shared by every parallel worker.
 */
export const SEEDED_NOTE_SLUG = 'hello-world';

/** A category the site's seed data always has (backend/db/seed.json). */
const SEEDED_CATEGORY = 'go';

/**
 * A valid published English note for the site admin API. The slug is unique (`e2e-note-...`), and the publish time is
 * a moment in the past so the note is live at once (the site treats a time after "now" as scheduled).
 */
export function buildNote(options: NoteOptions = {}): SiteNoteInput {
  const slug = uniqueId('note');
  const liveInSeconds = options.liveInSeconds ?? -2;
  return {
    slug,
    title: options.title ?? `E2E note ${slug}`,
    body: `Written by the Brain Town e2e suite (${slug}). Safe to delete.`,
    status: 'published',
    category: SEEDED_CATEGORY,
    publishedAt: new Date(Date.now() + liveInSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    locale: options.locale ?? 'en',
  };
}
