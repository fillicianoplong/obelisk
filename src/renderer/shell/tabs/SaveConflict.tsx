import { useEffect, useRef } from 'react';
import { CONFLICT_CHOICES, CONFLICT_MESSAGE, CONFLICT_TITLE } from './save.js';
import type { ConflictChoice } from './save.js';

interface SaveConflictProps {
  onChoose: (choice: ConflictChoice) => void;
}

export function SaveConflict({ onChoose }: SaveConflictProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);
  return (
    <div className="save-conflict-backdrop">
      <div
        className="save-conflict"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="save-conflict-title"
        aria-describedby="save-conflict-text"
        data-save-conflict=""
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onChoose('cancel');
          }
        }}
      >
        <h2 id="save-conflict-title" className="save-conflict-title">{CONFLICT_TITLE}</h2>
        <p id="save-conflict-text" className="save-conflict-text">{CONFLICT_MESSAGE}</p>
        <div className="save-conflict-actions">
          {CONFLICT_CHOICES.map((item) => (
            <button
              key={item.choice}
              type="button"
              className="save-conflict-button"
              data-save-choice={item.choice}
              ref={item.choice === 'cancel' ? cancelRef : undefined}
              onClick={() => onChoose(item.choice)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
