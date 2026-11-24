import { z } from 'zod';

export const IntegrationKindSchema = z.enum(['github', 'qa', 'gaos', 'site', 'animora']);
export type IntegrationKind = z.infer<typeof IntegrationKindSchema>;
/** Kinds that sign in with a Bearer token. GitHub uses a webhook secret instead (see the github client). */
export type IngestKind = Exclude<IntegrationKind, 'github'>;

export const SessionSchema = z.object({ email: z.email(), mode: z.string().min(1) });
export const LoginSchema = z.object({ email: z.email() });

/** An integration as the admin API returns it. The token hash never leaves the server. */
export const IntegrationSchema = z
  .object({
    id: z.string().regex(/^(github|qa|gaos|site|animora)-[0-9a-f]{6}$/),
    kind: IntegrationKindSchema,
    name: z.string(),
    org: z.string().optional(),
    feedUrl: z.string().optional(),
    /** GitHub only: events subscribed on the webhook. Other kinds send an empty list (or null). */
    events: z.array(z.string()).nullish(),
    /** GitHub only: who owns the repos; "" until set at creation or adopted from the first payload. */
    ownerType: z.enum(['', 'user', 'organization']),
    tokenHint: z.string().length(4),
    createdAt: z.iso.datetime({ offset: true }),
    lastEventAt: z.string(),
    lastRejectedAt: z.string(),
  })
  .strict();
export type Integration = z.infer<typeof IntegrationSchema>;

/** One repository of a GitHub owner, sorted by name in the list. today/rejected count today's deliveries. */
export const RepoRowSchema = z
  .object({
    name: z.string(),
    private: z.boolean(),
    hookEvents: z.array(z.string()),
    lastEventAt: z.string(),
    lastRejectedAt: z.string(),
    today: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    product: z.string(),
    visibility: z.enum(['public', 'hidden']),
    alias: z.string(),
    aliasCustom: z.boolean(),
    defaultAlias: z.string(),
  })
  .strict();
export type RepoRow = z.infer<typeof RepoRowSchema>;

export const IntegrationRowSchema = IntegrationSchema.extend({
  today: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  repos: z.array(RepoRowSchema),
});
export const IntegrationListSchema = z.array(IntegrationRowSchema);

export const TOKEN_PATTERN = /^bt_live_[0-9a-f]{48}$/;
export const CreatedIntegrationSchema = z.object({
  integration: IntegrationSchema,
  token: z.string().regex(TOKEN_PATTERN),
  ingestPath: z.string(),
});
export const RotatedTokenSchema = z.object({ token: z.string().regex(TOKEN_PATTERN) });

export const VisibilitySchema = z.enum(['public', 'hidden']);
export const OrgSchema = z.object({ key: z.string(), visibility: VisibilitySchema, alias: z.string() });
export const ProductSchema = z.object({
  key: z.string(),
  org: z.string().optional(),
  name: z.string().optional(),
  visibility: VisibilitySchema,
  alias: z.string(),
  hall: z.string(),
  sources: z.array(z.string()),
});
export const ProductsSchema = z.object({ orgs: z.array(OrgSchema), products: z.array(ProductSchema) });
export type Org = z.infer<typeof OrgSchema>;
export type Product = z.infer<typeof ProductSchema>;

/** The public form of an event: the same object is sent on /events and embedded as `public` in admin views. */
export const PublicEventSchema = z
  .object({
    seq: z.number().int().positive(),
    id: z.string(),
    type: z.string(),
    source: z.enum(['github', 'gaos', 'qa', 'site', 'animora']),
    at: z.iso.datetime(),
    payload: z.record(z.string(), z.unknown()),
    /** QA events only: the name of the QA integration that sent it, looked up when the event is viewed. */
    tool: z.string().optional(),
  })
  .strict();
export type PublicEvent = z.infer<typeof PublicEventSchema>;

/** One stored delivery (accepted or rejected) with its public view, from /api/admin/events and /admin/events. */
export const AdminEventSchema = z.object({
  seq: z.number().int().positive(),
  id: z.string(),
  integration: z.string(),
  kind: z.string(),
  type: z.string(),
  at: z.string(),
  received: z.string(),
  delivery: z.enum(['ok', 'rejected']),
  status: z.number().int(),
  reason: z.string().optional(),
  product: z.string().optional(),
  org: z.string().optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
  public: PublicEventSchema,
});
export const AdminEventListSchema = z.array(AdminEventSchema);
export type AdminEvent = z.infer<typeof AdminEventSchema>;

/** `timezone` is the IANA name the town clock and day boundaries use (default Asia/Jakarta). */
export const SettingsSchema = z
  .object({ retentionDays: z.number().int(), animation: z.boolean(), timezone: z.string().min(1) })
  .strict();
export type Settings = z.infer<typeof SettingsSchema>;

export const StatsSchema = z.object({
  Integrations: z.number().int().nonnegative(),
  Orgs: z.number().int().nonnegative(),
  Products: z.number().int().nonnegative(),
  Events: z.number().int().nonnegative(),
  Rejected: z.number().int().nonnegative(),
});
