import { createHash } from 'node:crypto';

function normalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalise);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalise(item)]),
    );
  }
  return value;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(normalise(value));
}

export function requestHash(value: unknown): string {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
}
