/**
 * Allowed test tags. Use the constants instead of raw strings so typos are impossible:
 *   test('creates a user', { tag: [Tag.smoke] }, async () => { ... });
 *
 * Run by tag:  npx playwright test --grep @smoke      Exclude:  --grep-invert @destructive
 */
export const Tag = {
  /** Fast, critical-path checks. Runs on every PR and after every deployment. Keep < 5 min total. */
  smoke: '@smoke',
  /** Full functional coverage. Runs nightly / before release. */
  regression: '@regression',
  /** Changes or deletes data that is not owned by the test. Outside local, skipped unless ALLOW_DESTRUCTIVE=true. */
  destructive: '@destructive',
  /** Known flaky, quarantined with a ticket. Excluded from blocking pipelines. */
  quarantine: '@quarantine',
} as const;

export type TagValue = (typeof Tag)[keyof typeof Tag];
