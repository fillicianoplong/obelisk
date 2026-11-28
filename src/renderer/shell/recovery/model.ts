import type { RecoverySummary } from '../../../shared/ipc/types.js';

export const RECOVERY_TITLE = 'Recover unsaved work';

export const RECOVERY_INTRO =
  'Obelisk closed before these documents were saved. Restore them to keep your changes.';

export const RECOVERY_NOT_NOW_LABEL = 'Not now';

export const RECOVERY_DISCARD_ALL_LABEL = 'Discard all';

export const RECOVERY_RESTORE_ALL_LABEL = 'Restore all';

export const RECOVERY_DAMAGED_HINT = 'This copy is damaged and cannot be restored.';

export function formatRecoveryTime(iso: string): string {
  const stamp = Date.parse(iso);
  if (!Number.isFinite(stamp)) {
    return iso;
  }
  return new Date(stamp).toLocaleString();
}

export function recoveryLastEdited(iso: string): string {
  return `Last edited ${formatRecoveryTime(iso)}`;
}

export function recoveryDocumentName(entry: RecoverySummary): string {
  const line = entry.firstLine.trim();
  if (line.length === 0) {
    return 'Untitled document';
  }
  return line;
}

export type RecoveryPromptChoice = 'restore' | 'discard' | 'dismiss';