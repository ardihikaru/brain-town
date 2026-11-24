import { z } from 'zod';

const VendorSchema = z.enum(['youtube', 'facebook', 'instagram', 'tiktok']);

/** One item of the Animora server's JSON Feed 1.1 (docs/integrations/animora.md, Part 2). */
export const AnimoraFeedItemSchema = z.object({
  id: z.string().regex(/^video-[A-Za-z0-9_-]+-(youtube|facebook|instagram|tiktok)-.+$/),
  url: z.url(),
  title: z.string().min(1),
  date_published: z.iso.datetime(),
  _animora: z.strictObject({
    vendor: VendorSchema,
    channel: z.string(),
    concept: z.string().optional(),
    code: z.string(),
  }),
});
export type AnimoraFeedItemOut = z.infer<typeof AnimoraFeedItemSchema>;

export const AnimoraFeedSchema = z.object({
  version: z.literal('https://jsonfeed.org/version/1.1'),
  title: z.literal('Animora'),
  home_page_url: z.url(),
  feed_url: z.url(),
  items: z.array(AnimoraFeedItemSchema),
});

/**
 * The raw envelope Brain Town stores for an Animora delivery (admin events, `raw`): rebuilt by the receiver, so only
 * these keys. Strict on purpose: a prompt, a script or any other extra key fails the contract.
 */
export const AnimoraRawSchema = z.strictObject({
  id: z.string().min(1),
  type: z.string().min(1),
  at: z.iso.datetime(),
  product: z.literal('animora'),
  org: z.string().optional(),
  data: z.record(z.string(), z.unknown()),
});
export type AnimoraRaw = z.infer<typeof AnimoraRawSchema>;

const SeededVideoSchema = z.object({
  code: z.string(),
  title: z.string(),
  externalId: z.string(),
  feedId: z.string(),
  url: z.url(),
});

/** .stack/animora/stack.json, written by animora-fixture/provision.mjs (ids and titles only, no tokens). */
export const AnimoraStackSchema = z.object({
  integration: z.object({ id: z.string() }),
  feedUrl: z.url(),
  channel: z.object({ code: z.string(), title: z.string() }),
  videos: z.object({ public: SeededVideoSchema, private: SeededVideoSchema, nonaktif: SeededVideoSchema }),
  senderEvents: z.array(z.object({ id: z.string(), type: z.string() })),
});
export type AnimoraStack = z.infer<typeof AnimoraStackSchema>;
