import type { APIRequestContext, APIResponse } from '@playwright/test';
import { BaseApiClient } from '@api/core/base-api-client';
import { restServices } from '@config/targets';

/** GET /api/town: the public, masked owners-and-repos snapshot the town draws its GitHub Valley gates from. */
export class TownClient extends BaseApiClient {
  constructor(request: APIRequestContext) {
    super(request, restServices.ingest.baseURL);
  }

  snapshot(): Promise<APIResponse> {
    return this.get('/api/town');
  }
}
