// SSE fan-out: M subscribers on /events while ingest runs at a constant rate. Measures delivery lag
// (ingest send → event received) and counts stream errors. Needs the xk6-sse build (perf/Dockerfile).
import sse from 'k6/x/sse';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { BASE, createIntegration, deleteIntegration, ingest } from './lib.js';

const SUBSCRIBERS = Number(__ENV.SSE_SUBSCRIBERS || 50);
const RATE = Number(__ENV.SSE_INGEST_RATE || 50);
const PUBLISH_FROM = 5; // s: subscribers connect first
const PUBLISH_FOR = 30; // s
const CLOSE_AFTER = PUBLISH_FROM + PUBLISH_FOR - 3; // s: close on the first event after this

const lag = new Trend('sse_delivery_lag', true);
const received = new Counter('sse_events_received');
const errors = new Counter('sse_errors');

export const options = {
  scenarios: {
    subscribers: {
      executor: 'per-vu-iterations',
      exec: 'subscribe',
      vus: SUBSCRIBERS,
      iterations: 1,
      maxDuration: `${PUBLISH_FROM + PUBLISH_FOR + 20}s`,
    },
    publisher: {
      executor: 'constant-arrival-rate',
      exec: 'publish',
      rate: RATE,
      timeUnit: '1s',
      duration: `${PUBLISH_FOR}s`,
      startTime: `${PUBLISH_FROM}s`,
      preAllocatedVUs: 10,
      maxVUs: 50,
    },
  },
  thresholds: {
    sse_delivery_lag: ['p(95)<1000'],
    sse_errors: ['count==0'],
    'checks{check:sse_200}': ['rate==1'],
    'checks{check:ingest_202}': ['rate==1'],
    'checks{check:sse_got_events}': ['rate==1'],
    'http_req_duration{name:ingest}': ['p(95)<200'],
  },
};

export function setup() {
  return createIntegration('perf sse fan-out');
}

export function subscribe() {
  const started = Date.now();
  let count = 0;
  const res = sse.open(`${BASE}/events`, { method: 'GET', tags: { name: 'events' } }, (client) => {
    client.on('event', (event) => {
      let body;
      try {
        body = JSON.parse(event.data);
      } catch {
        return;
      }
      const sentAt = body && body.payload && body.payload.data && body.payload.data.sentAt;
      if (typeof sentAt === 'number') {
        lag.add(Date.now() - sentAt);
        received.add(1);
        count += 1;
      }
      if (Date.now() - started > CLOSE_AFTER * 1000) client.close();
    });
    client.on('error', () => errors.add(1));
  });
  check(res, { sse_200: (r) => r && r.status === 200 });
  check(count, { sse_got_events: (n) => n > 0 });
}

export function publish(data) {
  check(ingest(data), { ingest_202: (r) => r.status === 202 });
}

export function teardown(data) {
  deleteIntegration(data);
}
