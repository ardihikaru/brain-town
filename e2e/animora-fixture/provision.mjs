#!/usr/bin/env node
/**
 * Provisions the Animora pieces of the e2e stack. Two phases, both called by scripts/stack.sh:
 *
 *   pre   (Brain Town up, Animora containers not yet)
 *         creates the stack-owned Brain Town "animora" integration and writes, under $ANIMORA_DIR (mode 600, never printed):
 *           server.env      ANIMORA_API_TOKEN for the Animora server (random, this stack only)
 *           sender.env      ANIMORA_NV_BRAIN_TOWN_ENABLED/URL/TOKEN for the real naskah-to-video sender
 *           events/*.json   the envelopes the real sender sends
 *           stack.json      what the specs need (ids, titles, codes; no tokens)
 *   seed  (Animora server ready)
 *         seeds the server through its own write API with a public, a private and a nonaktif published video, and points
 *         the integration's feedUrl at the server's real /feed.json (https front, throwaway CA).
 *
 * Reads ADMIN_EMAIL, ADMIN_PASSWORD, BRAIN_TOWN_URL and ANIMORA_DIR from the environment. Dependency-free (Node fetch).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const { ADMIN_EMAIL, ADMIN_PASSWORD, BRAIN_TOWN_URL, ANIMORA_DIR } = process.env;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD || !BRAIN_TOWN_URL || !ANIMORA_DIR) {
  console.error('provision: ADMIN_EMAIL, ADMIN_PASSWORD, BRAIN_TOWN_URL and ANIMORA_DIR are required');
  process.exit(1);
}
const phase = process.argv[2];
const base = BRAIN_TOWN_URL.replace(/\/+$/, '');
// Where the sender reaches Brain Town's ingest and where Brain Town's puller reaches the server (see tls-front.conf).
const INGEST_ORIGIN = 'https://animora-brain-town-tls:8443';
const FEED_URL = 'https://animora-pull-tls:8443/feed.json';
const SERVER = 'http://127.0.0.1:18285';
const stackFile = path.join(ANIMORA_DIR, 'stack.json');

async function call(origin, method, route, body, headers = {}) {
  const res = await globalThis.fetch(origin + route, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: globalThis.AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${method} ${route} answered ${res.status}`);
  return res;
}

async function brainTownSession() {
  const login = await call(base, 'POST', '/api/admin/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  return login.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

function write(file, content) {
  fs.writeFileSync(path.join(ANIMORA_DIR, file), content, { mode: 0o600 });
}

async function pre() {
  const cookie = await brainTownSession();
  const created = await (
    await call(base, 'POST', '/api/admin/integrations', { kind: 'animora', name: 'e2e-animora' }, { cookie })
  ).json();
  await call(base, 'POST', '/api/admin/logout', undefined, { cookie }).catch(() => undefined);

  const n = crypto.randomBytes(3).toString('hex');
  const channel = { code: `e2ekanal${n}`, title: `Kanal E2E ${n}` };
  const video = (kind) => ({
    code: `e2e${n}${kind}`,
    title: `E2E Animora ${kind} ${n}`,
    externalId: `E2Eext${n}${kind}`,
  });
  const videos = { public: video('pub'), private: video('priv'), nonaktif: video('off') };
  for (const v of Object.values(videos)) {
    v.feedId = `video-${v.code}-youtube-${v.externalId}`;
    v.url = `https://youtu.be/${v.externalId}`;
  }

  fs.mkdirSync(path.join(ANIMORA_DIR, 'events'), { recursive: true, mode: 0o700 });
  write('server.env', `ANIMORA_API_TOKEN=${crypto.randomBytes(24).toString('hex')}\n`);
  write(
    'sender.env',
    `ANIMORA_NV_BRAIN_TOWN_ENABLED=true\nANIMORA_NV_BRAIN_TOWN_URL=${INGEST_ORIGIN}${created.ingestPath}\nANIMORA_NV_BRAIN_TOWN_TOKEN=${created.token}\n`,
  );

  const pub = videos.public;
  const at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const envelopes = {
    '1-rendered': {
      id: `video-${pub.code}`,
      type: 'video.rendered',
      at,
      data: { title: pub.title, channel: channel.title, language: 'id', duration: 42, format: 'video', code: pub.code },
    },
    '2-scheduled': {
      id: `plan-${pub.code}-${channel.code}-youtube-sched`,
      type: 'video.scheduled',
      at,
      data: { vendor: 'youtube', channel: channel.title, title: pub.title, dueAt: at, code: pub.code },
    },
    // Same id as the item the server's /feed.json carries for this video: push and pull dedupe each other.
    '3-published': {
      id: pub.feedId,
      type: 'video.published',
      at,
      data: {
        vendor: 'youtube',
        channel: channel.title,
        title: pub.title,
        url: pub.url,
        publishedAt: at,
        code: pub.code,
      },
    },
  };
  for (const [name, envelope] of Object.entries(envelopes))
    write(`events/${name}.json`, `${JSON.stringify(envelope)}\n`);
  write(
    'stack.json',
    `${JSON.stringify({ integration: { id: created.integration.id }, feedUrl: FEED_URL, channel, videos, senderEvents: Object.values(envelopes).map((e) => ({ id: e.id, type: e.type })) })}\n`,
  );
  console.log(`✔ animora integration created (${created.integration.id})`);
}

async function seed() {
  const stack = JSON.parse(fs.readFileSync(stackFile, 'utf8'));
  const token = /^ANIMORA_API_TOKEN=(.+)$/m.exec(fs.readFileSync(path.join(ANIMORA_DIR, 'server.env'), 'utf8'))?.[1];
  const auth = { authorization: `Bearer ${token}` };
  const post = (route, body) => call(SERVER, 'POST', route, body, auth);

  await post('/channels', { code: stack.channel.code, title: stack.channel.title, status: 'active' });
  const flags = { public: {}, private: { privat: true }, nonaktif: { nonaktif: true } };
  for (const [kind, v] of Object.entries(stack.videos)) {
    await post('/videos', {
      code: v.code,
      title: v.title,
      duration: 42,
      status: 'rendered',
      language: 'id',
      channel: stack.channel.code,
      ...flags[kind],
    });
    // Every video has a public YouTube publication: only the video's own flags keep private and nonaktif ones out.
    await post('/publications', {
      video: v.code,
      vendor: 'youtube',
      external_id: v.externalId,
      privacy_status: 'public',
      title: v.title,
      channel: stack.channel.code,
    });
  }

  const cookie = await brainTownSession();
  await call(base, 'PATCH', `/api/admin/integrations/${stack.integration.id}`, { feedUrl: stack.feedUrl }, { cookie });
  await call(base, 'POST', '/api/admin/logout', undefined, { cookie }).catch(() => undefined);
  console.log('✔ animora server seeded (public, private and nonaktif video), feedUrl set');
}

if (phase === 'pre') await pre();
else if (phase === 'seed') await seed();
else {
  console.error('usage: provision.mjs pre|seed');
  process.exit(2);
}
