import fs from 'node:fs';
import path from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import { env } from '@config/env';
import { expectJson } from '@api/core/assertions';
import type { AdminClient } from '@api/rest/admin/admin.client';
import { AdminEventListSchema, AdminEventSchema, type AdminEvent } from '@api/rest/admin/admin.schemas';
import type { SseConnection } from '@api/stream/events/events.client';
import { AnimoraClient } from './animora.client';
import { AnimoraStackSchema, type AnimoraStack } from './animora.schemas';

/** scripts/stack.sh writes these when the Animora services started (see animora-fixture/provision.mjs). */
const STACK_DIR = path.resolve(__dirname, '..', '..', '..', '..', '..', '.stack', 'animora');

function loadStack(): AnimoraStack | undefined {
  const file = path.join(STACK_DIR, 'stack.json');
  if (!fs.existsSync(file)) return undefined;
  return AnimoraStackSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
}

const stack = loadStack();

/** False when the stack was started without the Animora repo (stack.sh warned). The both-sides specs skip then. */
export const ANIMORA_AVAILABLE = stack !== undefined;
export const ANIMORA_SKIP_REASON =
  'the Animora services are not part of this stack: stack.sh did not find the Animora repo with the Brain Town emitter (set ANIMORA_REPO_DIR / ANIMORA_REF)';

export interface AnimoraTarget {
  /** The real Animora server (public feed). */
  readonly server: AnimoraClient;
  /** The stack-owned Brain Town "animora" integration (owned by the stack, never deleted by a test). */
  readonly integrationId: string;
  readonly seed: AnimoraStack;
}

export async function setupAnimora({
  apiContextFor,
}: {
  apiContextFor: (role: 'admin' | 'anonymous') => Promise<APIRequestContext>;
}): Promise<AnimoraTarget> {
  if (!stack) throw new Error(ANIMORA_SKIP_REASON);
  const request = await apiContextFor('anonymous');
  return {
    server: new AnimoraClient(request, env.ANIMORA_SERVER_URL),
    integrationId: stack.integration.id,
    seed: stack,
  };
}

/** One line per send of the real naskah-to-video sender: `delivered|failed <file> pass<N>` (no body, no token). */
export function senderResults(): { outcome: string; file: string; pass: string }[] {
  const log = path.join(STACK_DIR, 'sender.log');
  if (!fs.existsSync(log)) return [];
  return fs
    .readFileSync(log, 'utf8')
    .split('\n')
    .flatMap((line) => {
      const [outcome, file, pass] = line.trim().split(' ');
      return outcome === 'delivered' || outcome === 'failed' ? [{ outcome, file: file ?? '', pass: pass ?? '' }] : [];
    });
}

/** Stored deliveries of one integration (newest first, at most 500), optionally narrowed by type or delivery. */
export async function deliveriesOf(
  adminApi: AdminClient,
  integration: string,
  query: { type?: string; delivery?: 'ok' | 'rejected' } = {},
): Promise<AdminEvent[]> {
  return expectJson(await adminApi.events({ integration, limit: 500, ...query }), AdminEventListSchema);
}

/** Waits (bounded, default 10 s) for the accepted delivery of envelope `id` on `integration` on the admin stream. */
export function awaitDelivery(stream: SseConnection, integration: string, id: string): Promise<AdminEvent> {
  return stream.waitForJson(AdminEventSchema, (e) => e.integration === integration && e.id === id);
}
