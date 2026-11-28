import { useEffect, useId, useRef, useState } from 'react';
import type { SignatureSummary } from '../../../shared/ipc/types.js';
import { DrawCanvas } from './DrawCanvas.js';
import type { SignatureStroke } from './raster.js';
import { pngFromStrokes, pngFromTypedText } from './raster.js';

export type SignatureDialogMode = 'insert' | 'change' | 'labels';

export interface SignatureDialogProps {
  mode: SignatureDialogMode;
  initialLabels: string[];
  initialLine: boolean;
  onCancel: () => void;
  onInsert: (png: Uint8Array) => void;
  onUpdateLabels: (labels: string[], line: boolean) => void;
}

type TabId = 'draw' | 'type' | 'image' | 'saved';

function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += chunk) {
    const slice = bytes.subarray(index, index + chunk);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

function SavedThumb({ id }: { id: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void window.obelisk['sig:get']({ id }).then((result) => {
      if (!active || result.status !== 'ok') {
        return;
      }
      setSrc(`data:image/png;base64,${result.png}`);
    }).catch(() => {
      /* preview optional */
    });
    return () => {
      active = false;
    };
  }, [id]);

  if (src === null) {
    return <span className="signature-dialog-saved-thumb" aria-hidden="true" />;
  }
  return <img className="signature-dialog-saved-thumb" src={src} alt="" draggable={false} />;
}

export function SignatureDialog({
  mode,
  initialLabels,
  initialLine,
  onCancel,
  onInsert,
  onUpdateLabels,
}: SignatureDialogProps) {
  const titleId = useId();
  const errorId = useId();
  const strokesRef = useRef<SignatureStroke[]>([]);
  const [tab, setTab] = useState<TabId>('draw');
  const [typed, setTyped] = useState('');
  const [saveName, setSaveName] = useState('');
  const [wantSave, setWantSave] = useState(false);
  const [labels, setLabels] = useState<string[]>(initialLabels.length > 0 ? initialLabels : ['', '']);
  const [line, setLine] = useState(initialLine);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SignatureSummary[]>([]);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [selectedSavedId, setSelectedSavedId] = useState<string | null>(null);

  const title = mode === 'labels' ? 'Edit line and labels' : mode === 'change' ? 'Change signature' : 'Signature';

  useEffect(() => {
    if (tab !== 'saved') {
      return;
    }
    void window.obelisk['sig:list']().then((result) => {
      if (result.status === 'unavailable') {
        setSavedNotice(result.message);
        setSaved([]);
        setSelectedSavedId(null);
        return;
      }
      if (result.status === 'ok') {
        setSavedNotice(null);
        setSaved(result.signatures);
        setSelectedSavedId(result.signatures[0]?.id ?? null);
      }
    }).catch(() => {
      setSavedNotice('Saved signatures could not be loaded.');
    });
  }, [tab]);

  async function rasterizeCurrent(): Promise<Uint8Array | null> {
    if (tab === 'draw') {
      return pngFromStrokes(strokesRef.current);
    }
    if (tab === 'type') {
      return pngFromTypedText(typed);
    }
    return null;
  }

  async function bytesFromSaved(id: string): Promise<Uint8Array | null> {
    const result = await window.obelisk['sig:get']({ id });
    if (result.status === 'unavailable') {
      setError(result.message);
      return null;
    }
    if (result.status !== 'ok') {
      setError('That saved signature could not be loaded.');
      return null;
    }
    const binary = atob(result.png);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index) & 0xff;
    }
    return bytes;
  }

  async function applyInsert(): Promise<void> {
    setError(null);
    if (mode === 'labels') {
      const cleaned = labels.map((row) => row.trim()).filter((row, index) => index < 2 && row.length > 0);
      onUpdateLabels(cleaned, line);
      return;
    }
    if (tab === 'saved') {
      if (selectedSavedId === null) {
        setError('Select a saved signature.');
        return;
      }
      const bytes = await bytesFromSaved(selectedSavedId);
      if (bytes === null) {
        return;
      }
      onInsert(bytes);
      return;
    }
    const bytes = await rasterizeCurrent();
    if (bytes === null) {
      setError('Add a signature first.');
      return;
    }
    if (wantSave) {
      const name = saveName.trim();
      if (name.length < 1) {
        setError('Enter a name to save this signature.');
        return;
      }
      const savedResult = await window.obelisk['sig:save']({ name, png: bytesToBase64(bytes) });
      if (savedResult.status === 'unavailable') {
        setError(savedResult.message);
        return;
      }
      if (savedResult.status === 'refused') {
        setError(savedResult.message);
        return;
      }
      if (savedResult.status === 'limitReached') {
        setError('You already have 10 saved signatures. Delete one to save another.');
        return;
      }
      if (savedResult.status === 'error') {
        setError(savedResult.message);
        return;
      }
    }
    onInsert(bytes);
  }

  function pickImage(): void {
    const pick = (window.obelisk as Record<string, unknown>)['image:pick'];
    if (typeof pick !== 'function') {
      setError('Image import requires the image file channel from OBL-62. Rebase this branch onto OBL-62 to use the Image tab.');
      return;
    }
    void (pick as () => Promise<unknown>)().then((result) => {
      const payload = result as { status: string; message?: string; image?: { data: string } };
      if (payload.status !== 'ok' || payload.image === undefined) {
        if (payload.status === 'refused' && typeof payload.message === 'string') {
          setError(payload.message);
        }
        return;
      }
      const binary = atob(payload.image.data);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index) & 0xff;
      }
      onInsert(bytes);
    }).catch(() => {
      setError('The image could not be opened.');
    });
  }

  async function deleteSaved(id: string): Promise<void> {
    const result = await window.obelisk['sig:delete']({ id });
    if (result.status === 'ok') {
      setSaved((current) => {
        const next = current.filter((entry) => entry.id !== id);
        setSelectedSavedId((selected) => {
          if (selected !== id) {
            return selected;
          }
          return next[0]?.id ?? null;
        });
        return next;
      });
    }
  }

  const showSaveRow = mode !== 'labels' && tab !== 'saved' && tab !== 'image';

  return (
    <div className="signature-dialog-backdrop">
      <div
        className="signature-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={error !== null ? errorId : undefined}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
      >
        <h2 id={titleId} className="signature-dialog-title">{title}</h2>
        {mode === 'labels' ? (
          <div className="signature-dialog-body">
            <div className="signature-dialog-labels-grid">
              <label className="signature-dialog-field">
                <span>Line below signature</span>
                <input type="checkbox" checked={line} onChange={(event) => setLine(event.target.checked)} />
              </label>
              <label className="signature-dialog-field" htmlFor="signature-label-1">
                Label line 1
                <input
                  id="signature-label-1"
                  className="signature-dialog-input"
                  value={labels[0] ?? ''}
                  maxLength={100}
                  onChange={(event) => setLabels([event.target.value, labels[1] ?? ''])}
                />
              </label>
              <label className="signature-dialog-field" htmlFor="signature-label-2">
                Label line 2
                <input
                  id="signature-label-2"
                  className="signature-dialog-input"
                  value={labels[1] ?? ''}
                  maxLength={100}
                  onChange={(event) => setLabels([labels[0] ?? '', event.target.value])}
                />
              </label>
            </div>
          </div>
        ) : (
          <div className="signature-dialog-body">
            <div className="signature-dialog-tabs" role="tablist" aria-label="Create signature by">
              {(['draw', 'type', 'image', 'saved'] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  className="signature-dialog-tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                >
                  {id === 'draw' ? 'Draw' : id === 'type' ? 'Type' : id === 'image' ? 'Image' : 'Saved'}
                </button>
              ))}
            </div>
            <div className="signature-dialog-panel">
              {tab === 'draw' ? <DrawCanvas strokesRef={strokesRef} /> : null}
              {tab === 'type' ? (
                <label className="signature-dialog-field" htmlFor="signature-type-text">
                  Typed signature
                  <input
                    id="signature-type-text"
                    className="signature-dialog-input signature-dialog-type"
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                    autoComplete="off"
                  />
                </label>
              ) : null}
              {tab === 'image' ? (
                <p className="signature-dialog-hint">Choose a PNG, JPEG, GIF, or WebP image file.</p>
              ) : null}
              {tab === 'saved' ? (
                <>
                  {savedNotice !== null ? <p className="signature-dialog-hint" role="status">{savedNotice}</p> : null}
                  {saved.length === 0 && savedNotice === null ? (
                    <p className="signature-dialog-empty">No saved signatures yet. Draw or type a signature and check Save for reuse.</p>
                  ) : null}
                  {saved.length > 0 ? (
                    <ul className="signature-dialog-saved-list">
                      {saved.map((entry) => (
                        <li
                          key={entry.id}
                          className="signature-dialog-saved-row"
                          aria-selected={selectedSavedId === entry.id}
                        >
                          <SavedThumb id={entry.id} />
                          <button
                            type="button"
                            className="signature-dialog-saved-select"
                            onClick={() => setSelectedSavedId(entry.id)}
                          >
                            {entry.name}
                          </button>
                          <button
                            type="button"
                            className="signature-dialog-saved-delete"
                            onClick={() => void deleteSaved(entry.id)}
                          >
                            Delete
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              ) : null}
            </div>
            {showSaveRow ? (
              <div className="signature-dialog-save-row">
                <label className="signature-dialog-save-check">
                  <input type="checkbox" checked={wantSave} onChange={(event) => setWantSave(event.target.checked)} />
                  <span>Save for reuse</span>
                </label>
                {wantSave ? (
                  <input
                    id="signature-save-name"
                    className="signature-dialog-input signature-dialog-save-name"
                    value={saveName}
                    maxLength={40}
                    placeholder="Saved name"
                    aria-label="Saved name"
                    onChange={(event) => setSaveName(event.target.value)}
                  />
                ) : null}
              </div>
            ) : null}
          </div>
        )}
        {error !== null ? <p id={errorId} className="signature-dialog-error" role="alert">{error}</p> : null}
        <div className="signature-dialog-footer">
          <div className="signature-dialog-actions">
            {mode !== 'labels' && tab === 'image' ? (
              <button type="button" className="signature-dialog-button signature-dialog-button-primary" onClick={pickImage}>
                Choose image…
              </button>
            ) : (
              <button type="button" className="signature-dialog-button signature-dialog-button-primary" onClick={() => void applyInsert()}>
                OK
              </button>
            )}
            <button type="button" className="signature-dialog-button" onClick={onCancel}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}