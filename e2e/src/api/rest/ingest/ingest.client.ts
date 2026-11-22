import type { APIRequestContext, APIResponse } from '@playwright/test';
import { BaseApiClient } from '@api/core/base-api-client';
import { restServices } from '@config/targets';

export interface IngestOptions {
  /** Bearer token; omit to send no Authorization header. */
  token?: string;
  idempotencyKey?: string;
}

/** POST /ingest/{kind}/{id}. The token is per integration, so it is passed per call, not stored on the client. */
export class IngestClient extends BaseApiClient {
  constructor(request: APIRequestContext) {
    super(request, restServices.ingest.baseURL);
  }

  send(path: string, body: unknown, options: IngestOptions = {}): Promise<APIResponse> {
    return this.post(path, { data: body, headers: this.headers(options) });
  }

  /** Sends a body verbatim (not JSON-encoded), for the malformed-body and size-limit checks. */
  sendRaw(path: string, body: string, options: IngestOptions = {}): Promise<APIResponse> {
    return this.post(path, { data: body, headers: { 'content-type': 'application/json', ...this.headers(options) } });
  }

  private headers(options: IngestOptions): Record<string, string> {
    const headers: Record<string, string> = {};
    if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
    if (options.idempotencyKey !== undefined) headers['idempotency-key'] = options.idempotencyKey;
    return headers;
  }
}
