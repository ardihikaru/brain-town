#!/usr/bin/env node
/**
 * Creates git-ignored working files from their committed *.example templates.
 * Never overwrites an existing file. Safe to run any time:  npm run env:init
 *
 * Brain Town addition: every `__FROM_PASSWORD_MANAGER__` placeholder is replaced with a fresh random value,
 * because the local stack is created from this file (admin password, ArcadeDB root password). Nothing here
 * is a real secret: it only protects a throwaway local stack bound to 127.0.0.1.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const templates = [['env/.env.local.example', 'env/.env.local']];

for (const [from, to] of templates) {
  const source = path.join(root, from);
  const target = path.join(root, to);
  if (!fs.existsSync(source)) continue;
  if (fs.existsSync(target)) {
    console.log(`• exists   ${to}`);
    continue;
  }
  const text = fs
    .readFileSync(source, 'utf8')
    .replaceAll('__FROM_PASSWORD_MANAGER__', () => crypto.randomBytes(18).toString('hex'));
  fs.writeFileSync(target, text, { mode: 0o600 });
  console.log(`✔ created  ${to}  (from ${from}, random local passwords)`);
}

console.log('\nNext: `npm run test:local` (starts the stack, runs the suite, shuts the stack down).');
