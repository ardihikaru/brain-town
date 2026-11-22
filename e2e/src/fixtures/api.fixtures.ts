import fs from 'node:fs/promises';
import path from 'node:path';
import { test as base, type APIRequestContext } from '@playwright/test';
import { env } from '@config/env';
import { credentials, streams } from '@config/targets';
import { AdminClient } from '@api/rest/admin/admin.client';
import {
  CreatedIntegrationSchema,
  LoginSchema,
  type IngestKind,
  type Integration,
} from '@api/rest/admin/admin.schemas';
import { IngestClient } from '@api/rest/ingest/ingest.client';
import { SseConnection, type SseConnectOptions } from '@api/stream/events/events.client';
import { expectJson } from '@api/core/assertions';
import { buildJsonFeed, type FeedItem } from '@data/factories/feed.factory';
import { uniqueId } from '@utils/unique';

export type ApiRole = 'admin' | 'anonymous';
type CleanupTask = () => Promise<unknown>;
type StorageState = Awaited<ReturnType<APIRequestContext['storageState']>>;

/** An integration created for one test, with its one-time token. Deleted after the test. */
export interface TestIntegration {
  readonly id: string;
  readonly kind: IngestKind;
  readonly token: string;
  /** `/ingest/<kind>/<id>`, relative to BRAIN_TOWN_URL. */
  readonly ingestPath: string;
  readonly integration: Integration;
}

export interface ApiWorkerFixtures {
  /** Logs the admin in once per worker and keeps the session cookie (storage state). */
  adminState: StorageState;
}

export interface ApiFixtures {
  /** Creates an APIRequestContext as `role`. All contexts are disposed after the test. */
  apiContextFor: (role: ApiRole) => Promise<APIRequestContext>;
  /** Admin API with a signed-in session. */
  adminApi: AdminClient;
  /** Admin API without a session (for 401 and login checks). */
  anonymousAdminApi: AdminClient;
  /** Ingest endpoints; the Bearer token is passed per call. */
  ingestApi: IngestClient;
  /** Creates an integration of `kind` through the admin API and deletes it after the test. */
  integration: (kind: IngestKind, input?: { name?: string; org?: string }) => Promise<TestIntegration>;
  /** SSE streams. Every connection is closed after the test. `admin` sends the session cookie. */
  sse: { connect: (stream: 'public' | 'admin', options?: SseConnectOptions) => Promise<SseConnection> };
  /** Publishes a JSON Feed file on the https feed fixture and returns its URL as the api container sees it. */
  feed: { publish: (items: FeedItem[]) => Promise<string> };
  /**
   * Register teardown work for data the test created. Runs after the test (pass or fail), in reverse order.
   */
  cleanup: { add: (task: CleanupTask) => void };
}

/** Folder served by the feed-fixture container (created by scripts/stack.sh, git-ignored). */
const FEED_DIR = path.resolve(__dirname, '..', '..', '.stack', 'feed');

function cookieHeader(state: StorageState): string {
  return state.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

export const apiTest = base.extend<ApiFixtures, ApiWorkerFixtures>({
  adminState: [
    async ({ playwright }, use) => {
      const context = await playwright.request.newContext({ timeout: env.API_TIMEOUT_MS });
      await expectJson(await new AdminClient(context).login(credentials.admin), LoginSchema);
      const state = await context.storageState();
      await context.dispose();
      await use(state);
    },
    { scope: 'worker' },
  ],

  apiContextFor: async ({ playwright, adminState }, use) => {
    const contexts: APIRequestContext[] = [];
    await use(async (role) => {
      const context = await playwright.request.newContext({
        timeout: env.API_TIMEOUT_MS,
        storageState: role === 'admin' ? adminState : undefined,
      });
      contexts.push(context);
      return context;
    });
    await Promise.all(contexts.map((c) => c.dispose()));
  },

  adminApi: async ({ apiContextFor }, use) => {
    await use(new AdminClient(await apiContextFor('admin')));
  },

  anonymousAdminApi: async ({ apiContextFor }, use) => {
    await use(new AdminClient(await apiContextFor('anonymous')));
  },

  ingestApi: async ({ apiContextFor }, use) => {
    await use(new IngestClient(await apiContextFor('anonymous')));
  },

  integration: async ({ adminApi, cleanup }, use) => {
    await use(async (kind, input = {}) => {
      const created = await expectJson(
        await adminApi.createIntegration({ kind, name: input.name ?? uniqueId(kind), org: input.org }),
        CreatedIntegrationSchema,
        201,
      );
      cleanup.add(() => adminApi.deleteIntegration(created.integration.id));
      return {
        id: created.integration.id,
        kind,
        token: created.token,
        ingestPath: created.ingestPath,
        integration: created.integration,
      };
    });
  },

  sse: async ({ adminState }, use) => {
    const open: SseConnection[] = [];
    await use({
      connect: async (stream, options = {}) => {
        const url = stream === 'admin' ? streams.adminEvents.url : streams.publicEvents.url;
        const headers = stream === 'admin' ? { cookie: cookieHeader(adminState), ...options.headers } : options.headers;
        const conn = await SseConnection.connect(url, { ...options, headers });
        open.push(conn);
        return conn;
      },
    });
    for (const conn of open) conn.close();
  },

  feed: async ({ cleanup }, use) => {
    await use({
      publish: async (items) => {
        const name = `${uniqueId('feed')}.json`;
        const file = path.join(FEED_DIR, name);
        await fs.writeFile(file, JSON.stringify(buildJsonFeed(items)), { mode: 0o644 });
        cleanup.add(() => fs.rm(file, { force: true }));
        return `${env.FEED_FIXTURE_URL.replace(/\/+$/, '')}/${name}`;
      },
    });
  },

  // Depends on apiContextFor so that API contexts are still alive while cleanup runs.
  cleanup: async ({ apiContextFor: _keepContextsAlive }, use, testInfo) => {
    const tasks: CleanupTask[] = [];
    await use({ add: (task) => tasks.push(task) });
    for (const task of tasks.reverse()) {
      try {
        await task();
      } catch (error) {
        // Never fail the test because of cleanup, but make it visible in the report.
        testInfo.annotations.push({ type: 'cleanup-failed', description: String(error) });
      }
    }
  },
});
