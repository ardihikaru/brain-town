import type { APIRequestContext, APIResponse } from '@playwright/test';

export type QueryParams = Record<string, string | number | boolean>;

export interface RequestOptions {
  params?: QueryParams;
  headers?: Record<string, string>;
  data?: unknown;
}

/**
 * Base class for every REST service client.
 *
 * Rules:
 * - One client per backend service (src/api/rest/<service>/<service>.client.ts).
 * - Methods map 1:1 to endpoints and return the raw `APIResponse`, so tests decide what to assert
 *   (status, headers, schema). Use `expectJson()` for the happy path.
 * - No assertions and no test data generation inside clients.
 */
export abstract class BaseApiClient {
  protected constructor(
    protected readonly request: APIRequestContext,
    protected readonly baseURL: string,
  ) {}

  /** Joins baseURL + path safely, so baseURL may be an origin or a gateway prefix (".../user-service"). */
  protected url(path: string): string {
    return `${this.baseURL.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  }

  protected get(path: string, options: RequestOptions = {}): Promise<APIResponse> {
    return this.request.get(this.url(path), options);
  }

  protected post(path: string, options: RequestOptions = {}): Promise<APIResponse> {
    return this.request.post(this.url(path), options);
  }

  protected put(path: string, options: RequestOptions = {}): Promise<APIResponse> {
    return this.request.put(this.url(path), options);
  }

  protected patch(path: string, options: RequestOptions = {}): Promise<APIResponse> {
    return this.request.patch(this.url(path), options);
  }

  protected delete(path: string, options: RequestOptions = {}): Promise<APIResponse> {
    return this.request.delete(this.url(path), options);
  }
}
