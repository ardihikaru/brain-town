import type { APIRequestContext, APIResponse } from '@playwright/test';
import { BaseApiClient } from '@api/core/base-api-client';
import { restServices } from '@config/targets';

export interface CreateIntegrationInput {
  /** Any string, so negative tests can send an unknown kind. */
  kind: string;
  name: string;
  org?: string;
}

export interface UpdateIntegrationInput {
  name?: string;
  org?: string;
  feedUrl?: string;
}

export interface VisibilityInput {
  /** `public` or `hidden`; any string so negative tests can send other values. */
  visibility?: string;
  alias?: string;
  hall?: string;
}

export interface EventQuery {
  integration?: string;
  type?: string;
  delivery?: 'ok' | 'rejected';
  q?: string;
  limit?: number;
}

/**
 * Admin API (cookie session). The request context carries the `bt_session` cookie after `login()`.
 * Mutations send JSON (the API answers 415 otherwise); `sendRaw` exists only for that negative case.
 */
export class AdminClient extends BaseApiClient {
  constructor(request: APIRequestContext) {
    super(request, restServices.admin.baseURL);
  }

  login(credentials: { email: string; password: string }): Promise<APIResponse> {
    return this.post('/api/admin/login', { data: credentials });
  }

  logout(): Promise<APIResponse> {
    return this.post('/api/admin/logout');
  }

  session(): Promise<APIResponse> {
    return this.get('/api/admin/session');
  }

  listIntegrations(): Promise<APIResponse> {
    return this.get('/api/admin/integrations');
  }

  createIntegration(input: CreateIntegrationInput): Promise<APIResponse> {
    return this.post('/api/admin/integrations', { data: input });
  }

  updateIntegration(id: string, input: UpdateIntegrationInput): Promise<APIResponse> {
    return this.patch(`/api/admin/integrations/${encodeURIComponent(id)}`, { data: input });
  }

  deleteIntegration(id: string): Promise<APIResponse> {
    return this.delete(`/api/admin/integrations/${encodeURIComponent(id)}`);
  }

  rotateToken(id: string): Promise<APIResponse> {
    return this.post(`/api/admin/integrations/${encodeURIComponent(id)}/token`);
  }

  products(): Promise<APIResponse> {
    return this.get('/api/admin/products');
  }

  putOrg(key: string, input: VisibilityInput): Promise<APIResponse> {
    return this.put(`/api/admin/orgs/${encodeURIComponent(key)}`, { data: input });
  }

  putProduct(key: string, input: VisibilityInput): Promise<APIResponse> {
    return this.put(`/api/admin/products/${encodeURIComponent(key)}`, { data: input });
  }

  events(query: EventQuery = {}): Promise<APIResponse> {
    const params = Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined)) as Record<
      string,
      string | number
    >;
    return this.get('/api/admin/events', { params });
  }

  getSettings(): Promise<APIResponse> {
    return this.get('/api/admin/settings');
  }

  putSettings(input: { retentionDays: number; animation: boolean }): Promise<APIResponse> {
    return this.put('/api/admin/settings', { data: input });
  }

  stats(): Promise<APIResponse> {
    return this.get('/api/admin/stats');
  }

  /** Sends a body with an explicit content type, for the 415 / 400 contract checks. */
  sendRaw(method: 'POST' | 'PUT' | 'PATCH', path: string, body: string, contentType: string): Promise<APIResponse> {
    return this.request.fetch(this.url(path), { method, data: body, headers: { 'content-type': contentType } });
  }
}
