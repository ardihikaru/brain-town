import { uniqueId } from '@utils/unique';

/**
 * GAOS envelopes, shaped like the real emitter (docs/integrations/gaos.md, "As built" GAOS v0.46.0):
 * product key is a lower-case id, columns are GAOS board ids, task kind is implement/design/review.
 * Every call gets unique ids and a unique product key, so parallel workers never see each other's events.
 */
export interface GaosProduct {
  key: string;
  name: string;
  visibility: 'public' | 'hidden';
}

export interface GaosTask {
  id: string;
  title: string;
  kind: 'implement' | 'design' | 'review';
  column: string;
}

export interface GaosEnvelope {
  id: string;
  type: string;
  at: string;
  product: GaosProduct;
  task?: GaosTask;
  data?: Record<string, unknown>;
}

export function buildGaosProduct(overrides: Partial<GaosProduct> = {}): GaosProduct {
  const key = uniqueId('p').toLowerCase();
  return { key, name: `Product ${key}`, visibility: 'public', ...overrides };
}

export function buildGaosTaskInfo(overrides: Partial<GaosTask> = {}): GaosTask {
  return {
    id: `T-${Math.floor(Math.random() * 9000) + 100}`,
    title: uniqueId('task'),
    kind: 'implement',
    column: 'backlog',
    ...overrides,
  };
}

/** `task.created`, valid by default. */
export function buildGaosTask(overrides: Partial<GaosEnvelope> = {}): GaosEnvelope {
  return {
    id: uniqueId('gaos-evt'),
    type: 'task.created',
    at: new Date().toISOString(),
    product: buildGaosProduct(),
    task: buildGaosTaskInfo(),
    ...overrides,
  };
}

/** `task.moved` for an existing product/task. */
export function buildGaosMove(product: GaosProduct, task: GaosTask, to: string): GaosEnvelope {
  return buildGaosTask({
    type: 'task.moved',
    product,
    task: { ...task, column: to },
    data: { from: task.column, to, agent: 'engineer' },
  });
}

/** `product.upserted` (no task). */
export function buildGaosProductUpserted(product: GaosProduct = buildGaosProduct()): GaosEnvelope {
  return { id: uniqueId('gaos-evt'), type: 'product.upserted', at: new Date().toISOString(), product };
}
