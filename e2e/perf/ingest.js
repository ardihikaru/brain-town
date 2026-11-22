// Ingest latency at a controlled rate: ramp to INGEST_TARGET_RPS (default 200 events/s, 4x the default
// per-integration INGEST_RATE) and hold it. Baseline thresholds; see README.md for results and the breaking point.
import { check } from 'k6';
import { createIntegration, deleteIntegration, ingest } from './lib.js';

const RPS = Number(__ENV.INGEST_TARGET_RPS || 200);

export const options = {
  scenarios: {
    ingest: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 20,
      maxVUs: 100,
      stages: [
        { duration: '10s', target: RPS },
        { duration: '30s', target: RPS },
        { duration: '5s', target: 0 },
      ],
    },
  },
  thresholds: {
    'http_req_duration{name:ingest}': ['p(95)<200'],
    'http_req_failed{name:ingest}': ['rate<0.01'],
    'checks{check:ingest_202}': ['rate==1'],
  },
};

export function setup() {
  return createIntegration('perf ingest');
}

export default function (data) {
  const res = ingest(data);
  check(res, { ingest_202: (r) => r.status === 202 });
}

export function teardown(data) {
  deleteIntegration(data);
}
