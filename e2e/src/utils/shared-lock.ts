import { mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from '@playwright/test';

/**
 * Some records are shared by the whole stack (the settings timezone, the product "animora") and Playwright runs
 * projects in parallel, so a test that flips one and a test that reads its effect could see each other. Both hold a
 * machine-wide named lock (an atomic mkdir) for their whole body and release it from `cleanup`, registered BEFORE the
 * restore task (cleanup runs in reverse, so the record is restored while the lock is still held).
 */
const lockDir = (name: string): string => join(tmpdir(), `brain-town-e2e-${name}.lock`);
/** A lock older than this was left by a crashed worker. */
const STALE_MS = 3 * 60_000;

async function tryAcquire(dir: string): Promise<boolean> {
  try {
    await mkdir(dir);
    return true;
  } catch {
    try {
      const age = Date.now() - (await stat(dir)).mtimeMs;
      if (age > STALE_MS) await rm(dir, { recursive: true, force: true });
    } catch {
      // The holder just released it; the next poll takes it.
    }
    return false;
  }
}

/** Waits for the named lock (bounded) and returns the release function. */
export async function lockShared(name: string): Promise<() => Promise<void>> {
  const dir = lockDir(name);
  await expect.poll(() => tryAcquire(dir), { timeout: 90_000, intervals: [50, 100, 250] }).toBe(true);
  return () => rm(dir, { recursive: true, force: true });
}

export const lockSettings = (): Promise<() => Promise<void>> => lockShared('settings');
/** The product "animora" is shared by every Animora integration; its visibility decides whether channels are masked. */
export const lockAnimoraProduct = (): Promise<() => Promise<void>> => lockShared('animora-product');
