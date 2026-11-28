import { useEffect, useId, useRef } from 'react';
import type { ExportFormat } from '../../../shared/ipc/types.js';

const EXPORT_CHOICES: readonly { format: ExportFormat; label: string }[] = [
  { format: 'pdf', label: 'PDF' },
  { format: 'docx', label: 'Word' },
  { format: 'markdown', label: 'Markdown' },
];

interface ExportDialogProps {
  onCancel: () => void;
  onChoose: (format: ExportFormat) => void;
}

export function ExportDialog({ onCancel, onChoose }: ExportDialogProps) {
  const titleId = useId();
  const hintId = useId();
  const firstRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  return (
    <div className="export-dialog-backdrop">
      <div
        className="export-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={hintId}
        data-export-dialog=""
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
      >
        <h2 id={titleId} className="export-dialog-title">Export</h2>
        <p id={hintId} className="export-dialog-hint">Choose a format. Your Obelisk document file is not changed.</p>
        <div className="export-dialog-formats" role="group" aria-label="Export format">
          {EXPORT_CHOICES.map((choice, index) => (
            <div key={choice.format} className="export-dialog-format">
              <button
                ref={index === 0 ? firstRef : undefined}
                type="button"
                className="export-dialog-button export-dialog-button-primary"
                data-export-format={choice.format}
                onClick={() => onChoose(choice.format)}
              >
                {choice.label}…
              </button>
            </div>
          ))}
        </div>
        <div className="export-dialog-actions">
          <button type="button" className="export-dialog-button" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}