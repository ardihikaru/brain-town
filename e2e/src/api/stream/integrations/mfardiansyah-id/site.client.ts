import type { APIRequestContext, APIResponse } from '@playwright/test';
import { BaseApiClient } from '@api/core/base-api-client';

export interface SiteNoteInput {
  slug: string;
  title: string;
  body: string;
  excerpt?: string;
  status: 'draft' | 'published' | 'scheduled';
  category: string;
  /** RFC 3339. A future time makes a published note "scheduled": not live (and not pushed) until then. */
  publishedAt: string;
  /** `en` (default) or `id`; Indonesian notes are neither in the feed nor pushed. */
  locale?: 'en' | 'id';
}

export interface SiteAdminAuth {
  user: string;
  password: string;
}

/**
 * One mfardiansyah.id api instance (the real Go service from the site repo, run by the e2e stack).
 * Note writes use the site's HTTP Basic admin login (ADMIN_BASIC_ENABLED, a random per-stack password).
 */
export class SiteClient extends BaseApiClient {
  private readonly authorization: string;

  constructor(request: APIRequestContext, baseURL: string, admin: SiteAdminAuth) {
    super(request, baseURL);
    this.authorization = `Basic ${Buffer.from(`${admin.user}:${admin.password}`).toString('base64')}`;
  }

  healthz(): Promise<APIResponse> {
    return this.get('/healthz');
  }

  feed(): Promise<APIResponse> {
    return this.get('/feed.json');
  }

  createNote(note: SiteNoteInput): Promise<APIResponse> {
    return this.post('/api/admin/posts', { data: note, headers: { authorization: this.authorization } });
  }

  saveNote(note: SiteNoteInput): Promise<APIResponse> {
    return this.put(`/api/admin/posts/${encodeURIComponent(note.slug)}`, {
      data: note,
      headers: { authorization: this.authorization },
    });
  }

  /** The site's PATCH merges the sent fields and requires the `version` the note was read at. */
  patchNote(slug: string, changes: { version: number } & Partial<SiteNoteInput>): Promise<APIResponse> {
    return this.patch(`/api/admin/posts/${encodeURIComponent(slug)}`, {
      data: changes,
      headers: { authorization: this.authorization },
    });
  }

  getNote(slug: string): Promise<APIResponse> {
    return this.get(`/api/admin/posts/${encodeURIComponent(slug)}`, { headers: { authorization: this.authorization } });
  }

  /** Moves the note to the trash, or removes it for good with `purge` (the note must be in the trash first). */
  deleteNote(slug: string, options: { purge?: boolean } = {}): Promise<APIResponse> {
    return this.delete(`/api/admin/posts/${encodeURIComponent(slug)}`, {
      params: options.purge ? { purge: 1 } : {},
      headers: { authorization: this.authorization },
    });
  }

  /** The home page, as a visitor with the given headers (user agent, X-Real-IP, cookies, ...). */
  home(headers: Record<string, string> = {}): Promise<APIResponse> {
    return this.get('/', { headers });
  }

  blog(slug: string, headers: Record<string, string> = {}): Promise<APIResponse> {
    return this.get(`/blog/${encodeURIComponent(slug)}`, { headers });
  }
}

/** The site's real nginx web image: static pages such as /office. */
export class SiteWebClient extends BaseApiClient {
  constructor(request: APIRequestContext, baseURL: string) {
    super(request, baseURL);
  }

  office(): Promise<APIResponse> {
    return this.get('/office');
  }
}
