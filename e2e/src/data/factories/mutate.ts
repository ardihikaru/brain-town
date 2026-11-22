/**
 * Returns a deep copy of `value` with one dotted path removed (`omit(env, 'product.key')`) or replaced
 * (`withValue(env, 'data.country', 'jp')`). For data-driven negative cases: one invalid field per row.
 */
export function omit<T extends object>(value: T, path: string): Record<string, unknown> {
  return edit(value, path, (parent, key) => {
    delete parent[key];
  });
}

export function withValue<T extends object>(value: T, path: string, next: unknown): Record<string, unknown> {
  return edit(value, path, (parent, key) => {
    parent[key] = next;
  });
}

function edit<T extends object>(
  value: T,
  path: string,
  change: (parent: Record<string, unknown>, key: string) => void,
): Record<string, unknown> {
  const copy = structuredClone(value) as Record<string, unknown>;
  const keys = path.split('.');
  const last = keys.pop();
  if (last === undefined) throw new Error('empty path');
  let parent = copy;
  for (const key of keys) {
    const next = parent[key];
    if (typeof next !== 'object' || next === null) throw new Error(`path ${path} does not exist`);
    parent = next as Record<string, unknown>;
  }
  change(parent, last);
  return copy;
}
