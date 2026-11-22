import { createHmac } from 'node:crypto';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { BaseApiClient } from '@api/core/base-api-client';
import { restServices } from '@config/targets';

export interface GithubSendOptions {
  /** The webhook secret (`whsec_…`) the delivery is signed with. */
  secret: string;
  /** X-GitHub-Delivery; GitHub's redelivery sends the same id again (409). */
  delivery: string;
  /** Replaces the computed X-Hub-Signature-256 value, to send a forged one. */
  signature?: string;
  /** Sends no X-Hub-Signature-256 header at all. */
  unsigned?: boolean;
  /** Defaults to application/json; GitHub's other choice is application/x-www-form-urlencoded (415). */
  contentType?: string;
}

/** "sha256=" + hex HMAC-SHA256 of the raw body, as GitHub computes X-Hub-Signature-256. */
export function signGithubBody(secret: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

/**
 * POST /ingest/github/{id}: a signed GitHub organisation webhook. Unlike the other sources there is no Bearer
 * token; the signature is over the exact bytes sent, so the body is serialised once and signed as that string.
 */
export class GithubClient extends BaseApiClient {
  constructor(request: APIRequestContext) {
    super(request, restServices.ingest.baseURL);
  }

  /** `body` is JSON-encoded unless it is already a string (used for the form-encoded 415 case). */
  send(path: string, event: string, body: unknown, options: GithubSendOptions): Promise<APIResponse> {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    const headers: Record<string, string> = {
      'content-type': options.contentType ?? 'application/json',
      'x-github-event': event,
      'x-github-delivery': options.delivery,
    };
    if (!options.unsigned) headers['x-hub-signature-256'] = options.signature ?? signGithubBody(options.secret, raw);
    return this.post(path, { data: raw, headers });
  }
}
