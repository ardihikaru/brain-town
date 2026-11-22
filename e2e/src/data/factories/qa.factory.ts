import { uniqueId } from '@utils/unique';

/**
 * QA tool envelopes, shaped like the real reporter (docs/integrations/qa-tool.md, "As built" PR #75):
 * `{id: "<run>-<seq>", type, at, product, org, run, data}`; `run` is shared by every event of one execution.
 */
export interface QaEnvelope {
  id: string;
  /** qa.run.started | qa.step | qa.run.finished (a string so negative tests can send others). */
  type: string;
  at: string;
  product: string;
  org?: string;
  run: string;
  data: Record<string, unknown>;
}

export interface QaRun {
  product: string;
  org: string;
  run: string;
  spec: string;
}

export function buildQaRun(overrides: Partial<QaRun> = {}): QaRun {
  return {
    product: uniqueId('qa-product').toLowerCase(),
    org: uniqueId('org').toLowerCase(),
    run: uniqueId('run'),
    spec: `${uniqueId('spec')}.spec.ts`,
    ...overrides,
  };
}

let seq = 0;
function envelope(run: QaRun, type: string, data: Record<string, unknown>): QaEnvelope {
  seq += 1;
  return {
    id: `${run.run}-${seq}`,
    type,
    at: new Date().toISOString(),
    product: run.product,
    org: run.org,
    run: run.run,
    data,
  };
}

export function buildQaRunStarted(
  run: QaRun = buildQaRun(),
  steps = ['Open page', 'Sign in', 'Check result'],
): QaEnvelope {
  return envelope(run, 'qa.run.started', { spec: run.spec, steps });
}

export function buildQaStep(
  run: QaRun,
  index: number,
  step: string,
  status: 'passed' | 'failed' = 'passed',
): QaEnvelope {
  return envelope(run, 'qa.step', { index, step, status, duration_ms: 120 });
}

export function buildQaRunFinished(run: QaRun, passed: number, failed: number): QaEnvelope {
  return envelope(run, 'qa.run.finished', { spec: run.spec, passed, failed, total: passed + failed, duration_ms: 900 });
}
