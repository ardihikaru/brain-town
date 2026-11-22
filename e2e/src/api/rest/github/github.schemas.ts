import { z } from 'zod';
import { IntegrationSchema } from '@api/rest/admin/admin.schemas';

/** `whsec_` + 32 random bytes, base64url without padding (docs/integrations/github.md, Secret). */
export const WEBHOOK_SECRET_PATTERN = /^whsec_[A-Za-z0-9_-]{43}$/;
const SecretSchema = z.string().regex(WEBHOOK_SECRET_PATTERN);

/** The three 202 outcomes of a delivery. GitHub's answer carries only the status. */
export const GithubAcceptedSchema = z.object({ status: z.literal('accepted') }).strict();
export const GithubIgnoredSchema = z.object({ status: z.literal('ignored') }).strict();
export const GithubSkippedSchema = z.object({ status: z.literal('skipped') }).strict();

/** POST /api/admin/integrations with kind github: the secret comes back as `token`. */
export const CreatedGithubIntegrationSchema = z
  .object({
    integration: IntegrationSchema,
    token: SecretSchema,
    ingestPath: z.string().regex(/^\/ingest\/github\/github-[0-9a-f]{6}$/),
  })
  .strict();
export const RevealedSecretSchema = z.object({ secret: SecretSchema }).strict();
export const RotatedSecretSchema = z.object({ token: SecretSchema }).strict();

/** The town envelope stored and pushed for a GitHub delivery (never the GitHub payload itself). */
export const GithubEnvelopeSchema = z
  .object({
    id: z.string().startsWith('gh-'),
    type: z.string(),
    at: z.iso.datetime(),
    org: z.string(),
    product: z
      .object({ key: z.string(), name: z.string(), visibility: z.enum(['public', 'hidden']) })
      .strict()
      .optional(),
    task: z
      .object({ id: z.string(), kind: z.enum(['issue', 'pr', 'discussion']), title: z.string().optional() })
      .strict()
      .optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
export type GithubEnvelope = z.infer<typeof GithubEnvelopeSchema>;

/** A /events message from GitHub: the public event with a typed payload. */
export const GithubPublicEventSchema = z
  .object({
    seq: z.number().int().positive(),
    id: z.string(),
    type: z.string(),
    source: z.literal('github'),
    at: z.iso.datetime(),
    payload: GithubEnvelopeSchema,
  })
  .strict();
export type GithubPublicEvent = z.infer<typeof GithubPublicEventSchema>;
