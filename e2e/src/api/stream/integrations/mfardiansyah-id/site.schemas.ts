import { z } from 'zod';

/** One item of the site's JSON Feed 1.1 (docs/integrations/mfardiansyah-id.md, "As built"). */
export const FeedItemSchema = z.object({
  id: z.string().regex(/^post-[a-z0-9-]+$/),
  url: z.url(),
  title: z.string().min(1),
  date_published: z.iso.datetime(),
  summary: z.string().optional(),
  tags: z.array(z.string()).min(1),
  _kind: z.literal('article'),
});
export type SiteFeedItem = z.infer<typeof FeedItemSchema>;

export const SiteFeedSchema = z.object({
  version: z.literal('https://jsonfeed.org/version/1.1'),
  title: z.string(),
  home_page_url: z.url(),
  feed_url: z.url(),
  language: z.string(),
  items: z.array(FeedItemSchema),
});

/** A note as the site admin API returns it after a save (only the fields the suite relies on). */
export const SitePostSchema = z.looseObject({
  slug: z.string().min(1),
  title: z.string().min(1),
  status: z.string(),
  locale: z.string().optional(),
  version: z.number().int().positive(),
  publishedAt: z.string().min(1),
});
export type SitePost = z.infer<typeof SitePostSchema>;

/** A seeded note: it has no `version` until it is saved once. */
export const SeededNoteSchema = z.looseObject({ slug: z.string().min(1), title: z.string().min(1) });

/**
 * The raw envelope Brain Town stores for what the site pushed (admin events, `raw`). Strict on purpose: an extra key
 * (an IP, a user agent, anything that identifies a person) fails the contract.
 */
export const ArticleRawSchema = z.strictObject({
  id: z.string().regex(/^post-[a-z0-9-]+$/),
  type: z.literal('article.published'),
  at: z.iso.datetime(),
  data: z.strictObject({ title: z.string().min(1), url: z.url(), to: z.literal('blog') }),
});

export const VisitRawSchema = z.strictObject({
  id: z.uuid(),
  type: z.literal('site.visit'),
  at: z.iso.datetime(),
  data: z.strictObject({
    page: z.enum(['home', 'blog']),
    country: z.string().regex(/^[A-Z]{2}$/),
    title: z.string().min(1).optional(),
  }),
});
export type SiteVisitRaw = z.infer<typeof VisitRawSchema>;

/** Only what is needed to recognise a visit; the strict check is a separate step so a bad key shows as a clear failure. */
export const VisitLooseSchema = z.looseObject({
  type: z.literal('site.visit'),
  data: z.looseObject({ page: z.string(), country: z.string() }),
});
