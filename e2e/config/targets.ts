import { env } from './env';

/**
 * Registry of everything this suite can talk to.
 *
 * Brain Town is one origin: nginx serves the town (/) and the back-office (/backoffice/) and proxies
 * /api/, /ingest/, /events and /admin/events to the Go api. playwright.config.ts and the fixtures derive
 * projects/clients from this file, so nothing else needs to know the URLs.
 */

const origin = env.BRAIN_TOWN_URL.replace(/\/+$/, '');

// ── REST services ──────────────────────────────────────────────────────────
export const restServices = {
  /** Admin API: cookie session, JSON bodies. */
  admin: { baseURL: origin },
  /** Ingest: Bearer token per integration. */
  ingest: { baseURL: origin },
} as const satisfies Record<string, { baseURL: string }>;

export type RestServiceName = keyof typeof restServices;

// ── Streams (SSE) ──────────────────────────────────────────────────────────
export const streams = {
  /** Public stream: accepted events only, masked. */
  publicEvents: { url: env.SSE_EVENTS_URL },
  /** Back-office stream: every delivery, needs the admin session cookie. */
  adminEvents: { url: `${origin}/admin/events` },
  /** Consumer stream: the stored envelope, scoped, needs a consumer bearer token. */
  consumerEvents: { url: `${origin}/consumer/events` },
} as const satisfies Record<string, { url: string }>;

// ── Frontend apps ──────────────────────────────────────────────────────────
export type Role = 'admin';

export interface WebAppTarget {
  /** Folder name under src/web/ and tests/web/; also used in Playwright project names. */
  readonly name: string;
  readonly baseURL: string;
  /** Logged-in browser state written by tests/setup/<name>.setup.ts (git-ignored). Absent = public app, no setup. */
  readonly storageState?: string;
  /** Which account the setup project logs in with. */
  readonly role?: Role;
}

export const webApps: readonly WebAppTarget[] = [
  { name: 'town', baseURL: `${origin}/` },
  { name: 'backoffice', baseURL: `${origin}/backoffice/`, storageState: '.auth/backoffice.json', role: 'admin' },
];

export function webApp(name: string): WebAppTarget {
  const app = webApps.find((a) => a.name === name);
  if (!app) throw new Error(`Unknown web app "${name}". Registered: ${webApps.map((a) => a.name).join(', ')}`);
  return app;
}

// ── Accounts ───────────────────────────────────────────────────────────────
export const credentials: Record<Role, { email: string; password: string }> = {
  admin: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
};
