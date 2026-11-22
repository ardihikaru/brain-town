#!/usr/bin/env node
/**
 * Creates the two stack-owned Brain Town "site" integrations for the mfardiansyah.id test services and writes what the
 * site containers and the specs need under e2e/.stack/site/ (mode 600, never printed):
 *
 *   push.env / pull.env   BRAIN_TOWN_URL + BRAIN_TOWN_TOKEN for the two site api containers (compose env_file)
 *   integrations.json     { push: { id }, pull: { id } } for the specs (no tokens)
 *
 * Called by scripts/stack.sh after the Brain Town stack is healthy. Reads ADMIN_EMAIL, ADMIN_PASSWORD, BRAIN_TOWN_URL
 * and SITE_DIR from the environment. Dependency-free (Node fetch).
 */
import fs from 'node:fs';
import path from 'node:path';

const { ADMIN_EMAIL, ADMIN_PASSWORD, BRAIN_TOWN_URL, SITE_DIR } = process.env;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !BRAIN_TOWN_URL || !SITE_DIR) {
  console.error('provision: ADMIN_EMAIL, ADMIN_PASSWORD, BRAIN_TOWN_URL and SITE_DIR are required');
  process.exit(1);
}
const base = BRAIN_TOWN_URL.replace(/\/+$/, '');
// Where the site containers reach Brain Town's ingest: the https front (see tls-front.conf).
const INGEST_ORIGIN = 'https://brain-town-tls:8443';

async function call(method, route, body, cookie) {
  const res = await globalThis.fetch(base + route, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: globalThis.AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${method} ${route} answered ${res.status}`);
  return res;
}

const login = await call('POST', '/api/admin/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
const cookie = login.headers
  .getSetCookie()
  .map((c) => c.split(';')[0])
  .join('; ');

fs.mkdirSync(SITE_DIR, { recursive: true, mode: 0o700 });
const ids = {};
for (const role of ['push', 'pull']) {
  const created = await (
    await call('POST', '/api/admin/integrations', { kind: 'site', name: `e2e-site-${role}` }, cookie)
  ).json();
  ids[role] = { id: created.integration.id };
  const env = `BRAIN_TOWN_URL=${INGEST_ORIGIN}${created.ingestPath}\nBRAIN_TOWN_TOKEN=${created.token}\n`;
  fs.writeFileSync(path.join(SITE_DIR, `${role}.env`), env, { mode: 0o600 });
}
fs.writeFileSync(path.join(SITE_DIR, 'integrations.json'), `${JSON.stringify(ids)}\n`, { mode: 0o600 });
await call('POST', '/api/admin/logout', undefined, cookie).catch(() => undefined);
console.log(`✔ site integrations created (${ids.push.id}, ${ids.pull.id})`);
