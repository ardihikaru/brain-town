import { test } from '@playwright/test';
import { env, isLocal } from '@config/env';

/**
 * Call at the top of any test tagged @destructive.
 * Destructive = modifies or deletes data the test did not create itself (shared config, other users, bulk ops).
 * Brain Town's suite is local-only, so this passes today; it stays so a future shared target is safe by default.
 */
export function skipUnlessDestructiveAllowed(): void {
  test.skip(
    !isLocal && !env.ALLOW_DESTRUCTIVE,
    `Destructive test skipped on TEST_ENV=${env.TEST_ENV}. Set ALLOW_DESTRUCTIVE=true to run it deliberately.`,
  );
}
