export const SCHEMA_REASONS = [
  'unknown-field',
  'wrong-type',
  'out-of-range',
  'missing-field',
  'invalid',
] as const;

export type SchemaReason = (typeof SCHEMA_REASONS)[number];

export interface SchemaFailure {
  ok: false;
  reason: SchemaReason;
  path: string;
  message: string;
}

export type CheckResult<T> = { ok: true; value: T } | SchemaFailure;

export function failure(reason: SchemaReason, path: string, message: string): SchemaFailure {
  return { ok: false, reason, path, message };
}
