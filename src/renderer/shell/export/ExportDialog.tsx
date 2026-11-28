import { useEffect, useId, useRef, useState } from 'react';
import type { ExportFormat } from '../../../shared/ipc/types.js';

const EXPORT_CHOICES: readonly {
  format: ExportFormat;
  label: string;
  description: string;
}[] = [
  {
    format: 'pdf',
    label: 'PDF',
    description: 'A fixed-layout file for sharing and printing.',
  },
  {
    format: 'docx',
    label: 'Word',
    description: 'A Microsoft Word document you can edit in Word.',
  },
  {
    format: 'markdown',
    label: 'Markdown',
    description: 'A plain-text file with lightweight markup.',
  },
];

interface ExportDialogProps {
  onCancel: () => void;
  onChoose: (format: ExportFormat) => void;
}

export function ExportDialog({ onCancel, onChoose }: ExportDialogProps) {
  const titleId = useId();
  const hintId = useId();
  const [format, setFormat] = useState<ExportFormat>('pdf');
  const firstRef = useRef<HTMLInputElement>(null);

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
        <div className="export-dialog-body">
          <p id={hintId} className="export-dialog-hint">
            Choose a format. Your Obelisk document file is not changed.
          </p>
          <div className="export-dialog-options" role="radiogroup" aria-labelledby={titleId}>
            {EXPORT_CHOICES.map((choice, index) => (
              <label key={choice.format} className="export-dialog-option">
                <input
                  ref={index === 0 ? firstRef : undefined}
                  type="radio"
                  name="export-format"
                  value={choice.format}
                  checked={format === choice.format}
                  data-export-format={choice.format}
                  onChange={() => setFormat(choice.format)}
                />
                <span className="export-dialog-option-text">
                  <span className="export-dialog-option-title">{choice.label}</span>
                  <span className="export-dialog-option-description">{choice.description}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        <footer className="export-dialog-footer">
          <button type="button" className="export-dialog-button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="export-dialog-button export-dialog-button-ok"
            onClick={() => onChoose(format)}
          >
            Export…
          </button>
        </footer>
      </div>
    </div>
  );
}