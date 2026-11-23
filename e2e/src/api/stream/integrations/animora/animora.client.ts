import type { APIRequestContext, APIResponse } from '@playwright/test';
import { BaseApiClient } from '@api/core/base-api-client';

/** The real Animora Go server run by the e2e stack (public, unauthenticated reads only). */
export class AnimoraClient extends BaseApiClient {
  constructor(request: APIRequestContext, baseURL: string) {
    super(request, baseURL);
  }

  readyz(): Promise<APIResponse> {
    return this.get('/readyz');
  }

  /** The public JSON Feed 1.1 of published videos. */
  feed(): Promise<APIResponse> {
    return this.get('/feed.json');
  }
}
