import { FIRST_LINE_MAX } from './limits.js';

export interface RecoveryMetadata {
  version: number;
  createdMs: number;
  updatedMs: number;
  firstLine: string;
}

export function parseRecoveryMetadata(text: string): RecoveryMetadata | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const version = record.version;
  const createdMs = record.createdMs;
  const updatedMs = record.updatedMs;
  const firstLine = record.firstLine;
  if (
    version !== 1 ||
    typeof createdMs !== 'number' ||
    !Number.isSafeInteger(createdMs) ||
    createdMs < 0 ||
    typeof updatedMs !== 'number' ||
    !Number.isSafeInteger(updatedMs) ||
    updatedMs < 0 ||
    typeof firstLine !== 'string' ||
    firstLine.length > FIRST_LINE_MAX ||
    firstLine.includes('\0') ||
    firstLine.includes('\n') ||
    firstLine.includes('\r')
  ) {
    return null;
  }
  return { version, createdMs, updatedMs, firstLine };
}

export function formatRecoveryMetadata(record: RecoveryMetadata): string {
  return `${JSON.stringify(record)}\n`;
}