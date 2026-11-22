import { mergeTests } from '@playwright/test';
import { apiTest } from './api.fixtures';
import { webTest } from './web.fixtures';

/**
 * The ONLY `test` that specs should import:
 *   import { test, expect } from '@fixtures';
 *
 * It contains every API client, the SSE client, the feed fixture, every frontend app object and the `cleanup` helper.
 * Fixtures are lazy — a spec only pays for what it actually destructures.
 */
export const test = mergeTests(apiTest, webTest);
export { expect } from '@playwright/test';
export type { ApiRole, TestIntegration } from './api.fixtures';
