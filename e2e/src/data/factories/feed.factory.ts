import { uniqueId } from '@utils/unique';

/** JSON Feed 1.1 items as mfardiansyah.id publishes them (id `post-<slug>`, same id as the push). */
export interface FeedItem {
  id: string;
  url: string;
  title: string;
  date_published: string;
}

export interface JsonFeed {
  version: string;
  title: string;
  items: FeedItem[];
}

export function buildFeedItem(overrides: Partial<FeedItem> = {}): FeedItem {
  const slug = uniqueId('feed');
  return {
    id: `post-${slug}`,
    url: `https://site.example.test/blog/${slug}`,
    title: `Feed article ${slug}`,
    date_published: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    ...overrides,
  };
}

export function buildJsonFeed(items: FeedItem[]): JsonFeed {
  return { version: 'https://jsonfeed.org/version/1.1', title: 'E2E feed fixture', items };
}
