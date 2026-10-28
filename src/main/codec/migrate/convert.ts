import { FORMAT_VERSION } from '../../../shared/schema/index.js';
import type { JsonValue } from '../json/result.js';

// Format 1 is the first format, so the step list is empty (architecture 6.7).
// A newer file is refused before the schema, because a later format may hold
// fields this app does not know. An older file walks the steps one version
// at a time. Tests pass their own step for a version that does not exist.

export const NEWER_VERSION_MESSAGE = 'Made by a newer Obelisk; update it from the Microsoft Store';

export const OLDER_VERSION_MESSAGE =
  'This file uses an older format, and this Obelisk has no conversion for it, so it was not opened.';

export const CONVERSION_FAILED_MESSAGE = 'This file could not be converted, so it was not opened.';

export interface MigrationStep {
  from: number;
  to: number;
  convert(
    document: JsonValue,
    manifest: JsonValue,
  ): { document: JsonValue; manifest: JsonValue };
}

export const MIGRATION_STEPS: readonly MigrationStep[] = Object.freeze([]);

export interface MigrateFailure {
  ok: false;
  reason: 'out-of-range' | 'invalid';
  path: '/formatVersion';
  message: string;
}

export interface MigrateSuccess {
  ok: true;
  document: JsonValue;
  manifest: JsonValue;
  formatVersion: number;
  migrated: boolean;
}

export type MigrateResult = MigrateSuccess | MigrateFailure;

function refused(reason: MigrateFailure['reason'], message: string): MigrateFailure {
  return { ok: false, reason, path: '/formatVersion', message };
}

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatVersionOf(manifest: JsonValue): number | null {
  if (!isRecord(manifest)) {
    return null;
  }
  const version = manifest.formatVersion;
  if (typeof version !== 'number' || !Number.isSafeInteger(version)) {
    return null;
  }
  return version;
}

function stepFrom(steps: readonly MigrationStep[], from: number): MigrationStep | undefined {
  return steps.find((step) => step.from === from && step.to === from + 1);
}

export function migrateOpened(
  document: JsonValue,
  manifest: JsonValue,
  steps: readonly MigrationStep[] = MIGRATION_STEPS,
  currentVersion: number = FORMAT_VERSION,
): MigrateResult {
  const version = formatVersionOf(manifest);
  if (version === null) {
    return { ok: true, document, manifest, formatVersion: currentVersion, migrated: false };
  }
  if (version > currentVersion) {
    return refused('out-of-range', NEWER_VERSION_MESSAGE);
  }
  if (version === currentVersion) {
    return { ok: true, document, manifest, formatVersion: version, migrated: false };
  }

  let currentDocument = document;
  let currentManifest = manifest;
  let current = version;
  while (current < currentVersion) {
    const step = stepFrom(steps, current);
    if (!step) {
      return refused('out-of-range', OLDER_VERSION_MESSAGE);
    }
    let converted: { document: JsonValue; manifest: JsonValue };
    try {
      converted = step.convert(structuredClone(currentDocument), structuredClone(currentManifest));
    } catch {
      return refused('invalid', CONVERSION_FAILED_MESSAGE);
    }
    if (formatVersionOf(converted.manifest) !== step.to) {
      return refused('invalid', CONVERSION_FAILED_MESSAGE);
    }
    currentDocument = converted.document;
    currentManifest = converted.manifest;
    current = step.to;
  }

  return {
    ok: true,
    document: currentDocument,
    manifest: currentManifest,
    formatVersion: current,
    migrated: true,
  };
}
