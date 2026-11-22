import { randomUUID } from 'node:crypto';
import { uniqueId } from '@utils/unique';

/**
 * mfardiansyah.id envelopes, shaped like the real site (docs/integrations/mfardiansyah-id.md, "As built" v0.54.3):
 * articles are `post-<slug>` with data {title, url, to: "blog"}; a visit carries only page and country.
 * URLs use the reserved `.test` TLD: no real site is ever referenced.
 */
export interface SiteEnvelope {
  id: string;
  /** article.published | illustration.published | site.visit (a string so negative tests can send others). */
  type: string;
  at: string;
  data: Record<string, unknown>;
}

export function buildArticle(overrides: Partial<SiteEnvelope> = {}): SiteEnvelope {
  const slug = uniqueId('post');
  return {
    id: `post-${slug}`,
    type: 'article.published',
    at: new Date().toISOString(),
    data: { title: `Article ${slug}`, url: `https://site.example.test/blog/${slug}`, to: 'blog' },
    ...overrides,
  };
}

export function buildSiteVisit(data: Record<string, unknown> = {}): SiteEnvelope {
  return {
    id: randomUUID(),
    type: 'site.visit',
    at: new Date().toISOString(),
    data: { page: 'blog', country: 'JP', title: uniqueId('visit-title'), ...data },
  };
}
