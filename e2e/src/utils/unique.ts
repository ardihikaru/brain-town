import { randomUUID } from 'node:crypto';

/** Every record created by this suite starts with this prefix, so leftovers on staging are easy to find and purge. */
export const E2E_PREFIX = 'e2e';

let counter = 0;

/**
 * Collision-free id that is safe across parallel workers and CI shards.
 * Example: e2e-user-w3-7-1f9c2a
 */
export function uniqueId(scope: string): string {
  counter += 1;
  // eslint-disable-next-line no-restricted-properties -- Playwright-provided worker index, not app config
  const worker = process.env.TEST_PARALLEL_INDEX ?? '0';
  return `${E2E_PREFIX}-${scope}-w${worker}-${counter}-${randomUUID().slice(0, 6)}`;
}
