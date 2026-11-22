/**
 * Application bugs found by this suite. A spec that hits one keeps its assertions and calls
 * `test.fail(true, KnownBug.<name>)` (AGENTS.md §6.5): it turns red as soon as the bug is fixed,
 * which is the signal to remove the marker. Never use these to hide a test bug.
 */
export const KnownBug = {
  /**
   * Back-office (src/backoffice.src.html, paintProducts): `ORGS.find(o => o.id === p.org)` is undefined for a
   * product without an org — every GAOS product, since GAOS events carry no org — and `o.vis` throws. loadLive()
   * fails, the sign-in shows "Signed in, but the API did not answer" and the live back-office never opens.
   */
  backofficeProductWithoutOrg:
    'BUG: back-office paintProducts() throws on a product without an org (every GAOS product), so the live ' +
    'back-office never loads. See e2e/docs/test-catalog/web-backoffice.md (TC-BO-003).',
} as const;
