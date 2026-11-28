import { useId } from 'react';
import { TabGlyph } from '../tabs/TabGlyph.js';
import type { RecoverySummary } from '../../../shared/ipc/types.js';
import {
  RECOVERY_DAMAGED_HINT,
  RECOVERY_DISCARD_ALL_LABEL,
  RECOVERY_INTRO,
  RECOVERY_NOT_NOW_LABEL,
  RECOVERY_RESTORE_ALL_LABEL,
  RECOVERY_TITLE,
  recoveryDocumentName,
  recoveryLastEdited,
} from './model.js';

export interface RecoveryEntryState extends RecoverySummary {
  damaged?: boolean;
}

interface RecoveryPromptProps {
  entries: readonly RecoveryEntryState[];
  onChoose: (recoveryId: string, choice: 'restore' | 'discard') => void;
  onDismiss: () => void;
  onDiscardAll: () => void;
  onRestoreAll: () => void;
}

export function RecoveryPrompt({
  entries,
  onChoose,
  onDismiss,
  onDiscardAll,
  onRestoreAll,
}: RecoveryPromptProps) {
  const titleId = useId();
  const introId = useId();
  const canRestoreAll = entries.some((entry) => entry.damaged !== true);

  return (
    <div className="recovery-dialog-backdrop">
      <div
        className="recovery-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={introId}
        data-recovery-prompt=""
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onDismiss();
          }
        }}
      >
        <header className="recovery-dialog-header">
          <h2 id={titleId} className="recovery-dialog-title">{RECOVERY_TITLE}</h2>
          <button
            type="button"
            className="recovery-dialog-close"
            aria-label={RECOVERY_NOT_NOW_LABEL}
            data-recovery-choice="dismiss"
            onClick={onDismiss}
          >
            <TabGlyph kind="close" />
          </button>
        </header>
        <p id={introId} className="recovery-dialog-intro">{RECOVERY_INTRO}</p>
        <ul className="recovery-dialog-list">
          {entries.map((entry) => (
            <li key={entry.id} className="recovery-dialog-row">
              <div className="recovery-dialog-row-copy">
                <p className="recovery-dialog-row-name">{recoveryDocumentName(entry)}</p>
                {entry.damaged === true ? (
                  <p className="recovery-dialog-row-damaged">{RECOVERY_DAMAGED_HINT}</p>
                ) : (
                  <p className="recovery-dialog-row-meta">{recoveryLastEdited(entry.time)}</p>
                )}
              </div>
              <div className="recovery-dialog-row-actions">
                {entry.damaged !== true ? (
                  <button
                    type="button"
                    className="recovery-dialog-button"
                    data-recovery-choice="restore"
                    data-recovery-id={entry.id}
                    onClick={() => onChoose(entry.id, 'restore')}
                  >
                    Restore
                  </button>
                ) : null}
                <button
                  type="button"
                  className="recovery-dialog-button"
                  data-recovery-choice="discard"
                  data-recovery-id={entry.id}
                  onClick={() => onChoose(entry.id, 'discard')}
                >
                  Discard
                </button>
              </div>
            </li>
          ))}
        </ul>
        <footer className="recovery-dialog-footer">
          {entries.length >= 2 ? (
            <div className="recovery-dialog-footer-side">
              <button
                type="button"
                className="recovery-dialog-button"
                data-recovery-choice="discard-all"
                onClick={onDiscardAll}
              >
                {RECOVERY_DISCARD_ALL_LABEL}
              </button>
            </div>
          ) : (
            <span className="recovery-dialog-footer-side" aria-hidden="true" />
          )}
          <div className="recovery-dialog-footer-side recovery-dialog-footer-side-end">
            <button
              type="button"
              className="recovery-dialog-button"
              data-recovery-choice="dismiss"
              onClick={onDismiss}
            >
              {RECOVERY_NOT_NOW_LABEL}
            </button>
            <button
              type="button"
              className="recovery-dialog-button recovery-dialog-button-primary"
              data-recovery-choice="restore-all"
              disabled={!canRestoreAll}
              onClick={onRestoreAll}
            >
              {RECOVERY_RESTORE_ALL_LABEL}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}