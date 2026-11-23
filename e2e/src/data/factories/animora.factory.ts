import { uniqueId } from '@utils/unique';

/**
 * Animora envelopes, shaped like the real senders (docs/integrations/animora.md, "When to send"): ids as the contract
 * has them, `data` limited to the allowlist. URLs use the reserved `.test` TLD: no real platform is ever referenced.
 */
export const VENDORS = ['youtube', 'facebook', 'instagram', 'tiktok'] as const;
export type Vendor = (typeof VENDORS)[number];

export const ANIMORA_TYPES = [
  'video.rendered',
  'video.scheduled',
  'video.published',
  'video.publish_failed',
  'channel.connected',
] as const;

export interface AnimoraEnvelope {
  id: string;
  /** One of ANIMORA_TYPES (a string so negative tests can send another). */
  type: string;
  at: string;
  data: Record<string, unknown>;
}

interface Parts {
  /** The opaque Animora video code (1 to 32 of A-Za-z0-9_-). */
  code: string;
  /** The kanal's code (id segment) and public display name. */
  channelCode: string;
  channel: string;
  title: string;
  vendor: Vendor;
}

/** The unique identity of one video as Animora would know it. */
export function buildVideoParts(overrides: Partial<Parts> = {}): Parts {
  const code = uniqueId('vid');
  return {
    code,
    channelCode: uniqueId('kc'),
    channel: `Kanal ${code}`,
    title: `Video ${code}`,
    vendor: 'youtube',
    ...overrides,
  };
}

function now(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** RFC 3339 (UTC, whole seconds) `seconds` ago. */
export function secondsAgo(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

type Override = Partial<Omit<AnimoraEnvelope, 'data'>> & { data?: Record<string, unknown> };

function envelope(base: AnimoraEnvelope, overrides: Override): AnimoraEnvelope {
  return { ...base, ...overrides, data: overrides.data ?? base.data };
}

export function buildVideoRendered(parts: Parts = buildVideoParts(), overrides: Override = {}): AnimoraEnvelope {
  return envelope(
    {
      id: `video-${parts.code}`,
      type: 'video.rendered',
      at: now(),
      data: {
        title: parts.title,
        channel: parts.channel,
        language: 'id',
        duration: 42,
        format: 'video',
        code: parts.code,
      },
    },
    overrides,
  );
}

export function buildVideoScheduled(parts: Parts = buildVideoParts(), overrides: Override = {}): AnimoraEnvelope {
  return envelope(
    {
      id: `plan-${parts.code}-${parts.channelCode}-${parts.vendor}-sched`,
      type: 'video.scheduled',
      at: now(),
      data: {
        vendor: parts.vendor,
        channel: parts.channel,
        title: parts.title,
        dueAt: '2030-01-02T03:04:05Z',
        code: parts.code,
      },
    },
    overrides,
  );
}

export function buildVideoPublished(parts: Parts = buildVideoParts(), overrides: Override = {}): AnimoraEnvelope {
  const external = uniqueId('ext');
  return envelope(
    {
      id: `video-${parts.code}-${parts.vendor}-${external}`,
      type: 'video.published',
      at: now(),
      data: {
        vendor: parts.vendor,
        channel: parts.channel,
        title: parts.title,
        url: `https://${parts.vendor}.example.test/watch/${external}`,
        publishedAt: now(),
        code: parts.code,
      },
    },
    overrides,
  );
}

export function buildVideoPublishFailed(parts: Parts = buildVideoParts(), overrides: Override = {}): AnimoraEnvelope {
  return envelope(
    {
      id: `plan-${parts.code}-${parts.channelCode}-${parts.vendor}-fail1`,
      type: 'video.publish_failed',
      at: now(),
      data: { vendor: parts.vendor, channel: parts.channel, title: parts.title, code: parts.code },
    },
    overrides,
  );
}

export function buildChannelConnected(parts: Parts = buildVideoParts(), overrides: Override = {}): AnimoraEnvelope {
  return envelope(
    {
      id: `chan-${parts.channelCode}-${parts.vendor}-${Math.floor(Date.now() / 1000)}`,
      type: 'channel.connected',
      at: now(),
      data: { vendor: parts.vendor, channel: parts.channel, account: `Akun ${parts.channelCode}` },
    },
    overrides,
  );
}

/** One valid envelope of every type for the same video, in the order Animora sends them. */
export function buildEveryType(parts: Parts = buildVideoParts()): AnimoraEnvelope[] {
  return [
    buildVideoRendered(parts),
    buildVideoScheduled(parts),
    buildVideoPublished(parts),
    buildVideoPublishFailed(parts),
    buildChannelConnected(parts),
  ];
}

/** `data` of an envelope without one key (for the missing-field 422 checks). */
export function without(data: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([k]) => k !== key));
}

/** A JSON Feed item as Animora's /feed.json carries it (`_animora` is the vendor block). */
export interface AnimoraFeedItem {
  id: string;
  url: string;
  title: string;
  date_published: string;
  _animora: { vendor: string; channel: string; code: string };
}

export function buildAnimoraFeedItem(
  parts: Parts = buildVideoParts(),
  overrides: Partial<AnimoraFeedItem> = {},
): AnimoraFeedItem {
  const external = uniqueId('ext');
  return {
    id: `video-${parts.code}-${parts.vendor}-${external}`,
    url: `https://${parts.vendor}.example.test/watch/${external}`,
    title: parts.title,
    date_published: now(),
    _animora: { vendor: parts.vendor, channel: parts.channel, code: parts.code },
    ...overrides,
  };
}
