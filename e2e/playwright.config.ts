import { defineConfig, devices, type Project, type ReporterDescription } from '@playwright/test';
import { env, isCI } from './config/env';
import { webApps } from './config/targets';

/**
 * Projects are generated from config/targets.ts:
 *
 *   api-rest                       → tests/api/rest/**        (admin API + ingest, no browser)
 *   api-stream                     → tests/api/stream/**      (/events and /admin/events SSE, feed puller)
 *   setup-<app>                    → tests/setup/<app>.setup.ts (apps with a login: saves .auth/<app>.json)
 *   web-<app>-<browser>            → tests/web/<app>/**       (depends on setup-<app> when the app has one)
 *
 * The suite never starts or stops the stack itself: `npm run test:local` wraps it with scripts/stack.sh
 * (up → tests → down). Plain `npx playwright test` expects a stack you started by hand and leaves it running.
 *
 * Run a subset with:  npx playwright test --project=api-rest   |   --project="web-*"   |   --grep @smoke
 */

const browserDevices = {
  chromium: devices['Desktop Chrome'],
  firefox: devices['Desktop Firefox'],
  webkit: devices['Desktop Safari'],
  'mobile-chrome': devices['Pixel 7'],
  'mobile-safari': devices['iPhone 15'],
} as const;
type BrowserKey = keyof typeof browserDevices;

const selectedBrowsers = env.BROWSERS.split(',')
  .map((b) => b.trim())
  .filter(Boolean)
  .map((b) => {
    if (!(b in browserDevices)) {
      throw new Error(`BROWSERS contains unknown "${b}". Use: ${Object.keys(browserDevices).join(', ')}`);
    }
    return b as BrowserKey;
  });

const channel = env.BROWSER_CHANNEL ? { channel: env.BROWSER_CHANNEL } : {};

const apiProjects: Project[] = [
  { name: 'api-rest', testDir: './tests/api/rest' },
  { name: 'api-stream', testDir: './tests/api/stream' },
];

const webProjects: Project[] = webApps.flatMap((app): Project[] => [
  ...(app.storageState
    ? [
        {
          name: `setup-${app.name}`,
          testDir: './tests/setup',
          testMatch: `${app.name}.setup.ts`,
          use: { ...devices['Desktop Chrome'], ...channel, baseURL: app.baseURL },
        },
      ]
    : []),
  ...selectedBrowsers.map((browser): Project => ({
    name: `web-${app.name}-${browser}`,
    testDir: `./tests/web/${app.name}`,
    dependencies: app.storageState ? [`setup-${app.name}`] : [],
    use: {
      ...browserDevices[browser],
      ...(browser === 'chromium' || browser === 'mobile-chrome' ? channel : {}),
      baseURL: app.baseURL,
      storageState: app.storageState,
    },
  })),
]);

const reporter: ReporterDescription[] = isCI
  ? [['list'], ['github'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/junit.xml' }]]
  : [['list'], ['html', { open: 'never' }]];

export default defineConfig({
  testMatch: '**/*.spec.ts',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 4 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter,
  metadata: { testEnv: env.TEST_ENV },

  use: {
    testIdAttribute: 'data-testid',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: isCI ? 'on-first-retry' : 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [...apiProjects, ...webProjects],
});
