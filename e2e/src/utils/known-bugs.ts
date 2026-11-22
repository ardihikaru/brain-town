/**
 * Application bugs found by this suite. A spec that hits one keeps its assertions and calls
 * `test.fail(true, KnownBug.<name>)` (AGENTS.md §6.5): it turns red as soon as the bug is fixed,
 * which is the signal to remove the marker. Never use these to hide a test bug.
 */
export const KnownBug = {
  // None open. TC-BO-003 (back-office crash on a product without an org) was fixed in src/backoffice.src.html.
} as const satisfies Record<string, string>;
