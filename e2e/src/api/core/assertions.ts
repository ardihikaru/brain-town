import { expect, type APIResponse } from '@playwright/test';
import { z } from 'zod';
import { ApiErrorSchema, type ApiError } from './schemas';

/**
 * Asserts the HTTP status and validates the JSON body against a zod schema (contract check).
 * Returns the parsed, fully typed body.
 *
 * @example
 *   const session = await expectJson(await adminApi.session(), SessionSchema);              // expects 200
 *   const created = await expectJson(await adminApi.createIntegration(p), CreatedSchema, 201);
 */
export async function expectJson<S extends z.ZodType>(
  response: APIResponse,
  schema: S,
  expectedStatus = 200,
): Promise<z.output<S>> {
  await expectStatus(response, expectedStatus);
  const body: unknown = await response.json();
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new Error(
      `Contract violation for ${response.url()}:\n${z.prettifyError(result.error)}\n\nBody: ${JSON.stringify(body, null, 2)}`,
    );
  }
  return result.data;
}

/**
 * Brain Town error contract: status + `{ error, field? }`. When `field` is given, the response must name exactly
 * that field (ingest 422/409). Assert on the field, not on the human-readable message.
 */
export async function expectError(response: APIResponse, expectedStatus: number, field?: string): Promise<ApiError> {
  const body = await expectJson(response, ApiErrorSchema, expectedStatus);
  if (field !== undefined) {
    expect(body.field, `${response.url()} should name the rejected field`).toBe(field);
  }
  return body;
}

/** Asserts the status code and prints the response body when it does not match (much faster debugging). */
export async function expectStatus(response: APIResponse, expectedStatus: number): Promise<void> {
  if (response.status() !== expectedStatus) {
    const body = await response.text().catch(() => '<unreadable body>');
    expect(
      response.status(),
      `${response.url()} returned ${response.status()} (expected ${expectedStatus}). Body: ${body}`,
    ).toBe(expectedStatus);
  }
}
