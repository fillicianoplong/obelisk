import { useEffect, useRef } from 'react';
import { CLOSE_CHOICES, CLOSE_TITLE, closePromptMessage } from './close.js';
import type { ClosePromptChoice } from './close.js';

interface ClosePromptProps {
  tabTitle: string;
  onChoose: (choice: ClosePromptChoice) => void;
}

export function ClosePrompt({ tabTitle, onChoose }: ClosePromptProps) {
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
        aria-labelledby="close-prompt-title"
        aria-describedby="close-prompt-text"
        data-close-prompt=""
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onChoose('cancel');
          }
        }}
      >
        <h2 id="close-prompt-title" className="save-conflict-title">{CLOSE_TITLE}</h2>
        <p id="close-prompt-text" className="save-conflict-text">{closePromptMessage(tabTitle)}</p>
        <div className="save-conflict-actions">
          {CLOSE_CHOICES.map((item) => (
            <button
              key={item.choice}
              type="button"
              className="save-conflict-button"
              data-close-choice={item.choice}
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
