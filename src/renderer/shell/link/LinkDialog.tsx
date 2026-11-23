import { useEffect, useId, useRef, useState } from 'react';
import {
  classifyLinkAddress,
  linkRefusalMessage,
} from '../../../shared/links/address.js';
import type { LinkDraft } from '../../editor/link/commands.js';

interface LinkDialogProps {
  draft: LinkDraft;
  onCancel: () => void;
  onSubmit: (text: string, address: string) => string | null;
}

export function LinkDialog({ draft, onCancel, onSubmit }: LinkDialogProps) {
  const titleId = useId();
  const textId = useId();
  const addressId = useId();
  const errorId = useId();
  const textRef = useRef<HTMLInputElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(draft.text);
  const [address, setAddress] = useState(draft.address);
  const [error, setError] = useState<string | null>(null);
  const title = draft.mode === 'edit' ? 'Edit link' : 'Link';

  useEffect(() => {
    const field = draft.text.length > 0 ? addressRef.current : textRef.current;
    field?.focus();
    if (draft.text.length > 0) {
      addressRef.current?.select();
    }
  }, [draft.text.length]);

  function submit(): void {
    const checked = classifyLinkAddress(address);
    if (!checked.ok) {
      setError(linkRefusalMessage(checked.reason));
      addressRef.current?.focus();
      return;
    }
    const failure = onSubmit(text, address);
    if (failure !== null) {
      setError(failure);
      addressRef.current?.focus();
    }
  }

  return (
    <div className="link-dialog-backdrop">
      <form
        className="link-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={error !== null ? errorId : undefined}
        data-link-dialog={draft.mode}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
      >
        <h2 id={titleId} className="link-dialog-title">{title}</h2>
        <label className="link-dialog-label" htmlFor={textId}>Text</label>
        <input
          id={textId}
          ref={textRef}
          className="link-dialog-input"
          type="text"
          value={text}
          data-link-text=""
          onChange={(event) => setText(event.target.value)}
        />
        <label className="link-dialog-label" htmlFor={addressId}>Address</label>
        <input
          id={addressId}
          ref={addressRef}
          className="link-dialog-input"
          type="text"
          value={address}
          spellCheck={false}
          aria-invalid={error !== null}
          data-link-address=""
          onChange={(event) => {
            setAddress(event.target.value);
            setError(null);
          }}
        />
        {error !== null ? (
          <p id={errorId} className="link-dialog-error" role="alert">{error}</p>
        ) : null}
        <div className="link-dialog-actions">
          <button type="submit" className="link-dialog-button" data-link-ok="">
            OK
          </button>
          <button
            type="button"
            className="link-dialog-button"
            data-link-cancel=""
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
