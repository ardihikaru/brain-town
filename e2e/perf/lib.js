// Shared helpers for the k6 scripts (runs inside k6, not Node). Local stack only.
import http from 'k6/http';
import { fail } from 'k6';

export const BASE = (__ENV.BRAIN_TOWN_URL || 'http://127.0.0.1:18280').replace(/\/+$/, '');

const PROTECTED = ['town.mfardiansyah.id', 'town.demo.mfardiansyah.id'];
const host = BASE.replace(/^https?:\/\//, '')
  .split(/[/:]/)[0]
  .toLowerCase();
if (PROTECTED.some((p) => host === p || host.endsWith(`.${p}`))) {
  throw new Error(`BRAIN_TOWN_URL=${BASE} is a protected host. Perf tests run against the local stack only.`);
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** Signs in and creates one GAOS integration for the run. Returns what the VUs need. */
export function createIntegration(name) {
  const login = http.post(
    `${BASE}/api/admin/login`,
    JSON.stringify({ email: __ENV.ADMIN_EMAIL, password: __ENV.ADMIN_PASSWORD }),
    { headers: JSON_HEADERS, tags: { name: 'admin' } },
  );
  if (login.status !== 200) fail(`admin login failed: ${login.status}`);
  const cookie = `bt_session=${login.cookies.bt_session[0].value}`;
  const res = http.post(`${BASE}/api/admin/integrations`, JSON.stringify({ kind: 'gaos', name }), {
    headers: { ...JSON_HEADERS, Cookie: cookie },
    tags: { name: 'admin' },
  });
  if (res.status !== 201) fail(`create integration failed: ${res.status}`);
  const body = res.json();
  return { cookie, id: body.integration.id, path: body.ingestPath, token: body.token, product: `perf-${Date.now()}` };
}

export function deleteIntegration(data) {
  http.del(`${BASE}/api/admin/integrations/${data.id}`, null, {
    headers: { Cookie: data.cookie },
    tags: { name: 'admin' },
  });
}

let seq = 0;
/** One GAOS task.created envelope with a unique id; `sentAt` (ms) lets subscribers measure delivery lag. */
export function envelope(data) {
  seq += 1;
  const id = `perf-${__VU}-${seq}-${Date.now()}`;
  return {
    id,
    type: 'task.created',
    at: new Date().toISOString(),
    product: { key: data.product, name: 'Perf product', visibility: 'public' },
    task: { id: `T-${seq}`, title: `Perf task ${id}`, kind: 'implement', column: 'backlog' },
    data: { sentAt: Date.now() },
  };
}

export function ingest(data) {
  return http.post(`${BASE}${data.path}`, JSON.stringify(envelope(data)), {
    headers: { ...JSON_HEADERS, Authorization: `Bearer ${data.token}` },
    tags: { name: 'ingest' },
  });
}
