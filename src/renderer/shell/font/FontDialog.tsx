import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type FormEvent, type RefObject } from 'react';
import { BUNDLED_FONT_FAMILY_NAMES } from '../../../shared/fonts/manifest.js';
import {
  FONT_HIGHLIGHT_COLORS,
  FONT_STYLE_LABELS,
  FONT_TEXT_COLORS,
  type FontDialogValue,
  type FontStyleId,
} from '../../editor/font-dialog.js';
import { FONT_SIZE_PT } from '../../editor/format/reference.js';

interface FontDialogProps {
  initial: FontDialogValue;
  preview: string;
  onCancel: () => void;
  onApply: (value: FontDialogValue) => void;
}

export function FontDialog({ initial, preview, onCancel, onApply }: FontDialogProps) {
  const titleId = useId();
  const familyId = useId();
  const [draft, setDraft] = useState<FontDialogValue>(initial);
  const [familyQuery, setFamilyQuery] = useState('');
  const [sizeText, setSizeText] = useState(String(initial.sizePt));
  const familyListRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    familyListRef.current?.querySelector<HTMLElement>('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, []);

  const filteredFamilies = useMemo(() => {
    const needle = familyQuery.trim().toLowerCase();
    if (needle.length === 0) {
      return BUNDLED_FONT_FAMILY_NAMES;
    }
    return BUNDLED_FONT_FAMILY_NAMES.filter((family) => family.toLowerCase().includes(needle));
  }, [familyQuery]);

  function patch(partial: Partial<FontDialogValue>): void {
    setDraft((current) => ({ ...current, ...partial }));
  }

  function chooseSize(value: string): void {
    setSizeText(value);
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      patch({ sizePt: parsed });
    }
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const parsed = Number(sizeText);
  if (!Number.isFinite(parsed) || parsed <= 0) {
      return;
    }
    onApply({ ...draft, sizePt: parsed });
  }

  const previewStyle = previewStyleFromDraft(draft);

  return (
    <div className="font-dialog-backdrop">
      <form
        className="font-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-font-dialog=""
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
      >
        <h2 id={titleId} className="font-dialog-title">Font</h2>
        <div className="font-dialog-body">
          <Example
            familyId={familyId}
            familyQuery={familyQuery}
            filteredFamilies={filteredFamilies}
            draft={draft}
            familyListRef={familyListRef}
            sizeText={sizeText}
            onFamilyQuery={setFamilyQuery}
            onPickFamily={(family) => patch({ family })}
            onStyle={(style: FontStyleId) => patch({ style })}
            onSizeText={setSizeText}
            onChooseSize={chooseSize}
            onPatch={patch}
          />
          <div className="font-dialog-preview-panel">
            <p className="font-dialog-section">Preview</p>
            <p className="font-dialog-preview" data-font-preview="" style={previewStyle}>
              {preview}
            </p>
          </div>
        </div>
        <div className="font-dialog-actions">
          <div className="font-dialog-actions-end">
            <button type="button" className="font-dialog-button" onClick={onCancel}>Cancel</button>
            <button type="submit" className="font-dialog-button font-dialog-button-primary">OK</button>
          </div>
        </div>
      </form>
    </div>
  );
}

interface ExampleProps {
  familyId: string;
  familyQuery: string;
  filteredFamilies: readonly string[];
  draft: FontDialogValue;
  familyListRef: RefObject<HTMLUListElement | null>;
  sizeText: string;
  onFamilyQuery: (value: string) => void;
  onPickFamily: (family: string) => void;
  onStyle: (style: FontStyleId) => void;
  onSizeText: (value: string) => void;
  onChooseSize: (value: string) => void;
  onPatch: (partial: Partial<FontDialogValue>) => void;
}

function Example({
  familyId,
  familyQuery,
  filteredFamilies,
  draft,
  familyListRef,
  sizeText,
  onFamilyQuery,
  onPickFamily,
  onStyle,
  onSizeText,
  onChooseSize,
  onPatch,
}: ExampleProps) {
  return (
    <div className="font-dialog-fields">
      <div className="font-dialog-row">
        <label className="font-dialog-label" htmlFor={familyId}>Font</label>
        <div className="font-dialog-family">
          <input
            id={familyId}
            className="font-dialog-input"
            type="search"
            value={familyQuery}
            placeholder="Search fonts"
            data-font-search=""
            onChange={(event) => onFamilyQuery(event.currentTarget.value)}
          />
          <ul className="font-dialog-family-list" ref={familyListRef} role="listbox" aria-label="Font family">
            {filteredFamilies.map((family) => (
              <li key={family}>
                <button
                  type="button"
                  role="option"
                  className="font-dialog-family-item"
                  data-selected={draft.family === family ? 'true' : 'false'}
                  aria-selected={draft.family === family}
                  onClick={() => onPickFamily(family)}
                >
                  {family}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="font-dialog-row font-dialog-row-split">
        <label className="font-dialog-label" htmlFor="font-dialog-style">Font style</label>
        <select
          id="font-dialog-style"
          className="font-dialog-select"
          value={draft.style}
          data-font-style=""
          onChange={(event) => onStyle(event.currentTarget.value as FontStyleId)}
        >
          {FONT_STYLE_LABELS.map((row) => (
            <option key={row.id} value={row.id}>{row.label}</option>
          ))}
        </select>
        <label className="font-dialog-label" htmlFor="font-dialog-size">Size</label>
        <div className="font-dialog-size">
          <select
            className="font-dialog-select"
            value={FONT_SIZE_PT.includes(draft.sizePt as typeof FONT_SIZE_PT[number]) ? String(draft.sizePt) : ''}
            data-font-size-preset=""
            onChange={(event) => onChooseSize(event.currentTarget.value)}
          >
            <option value="" disabled hidden>Preset</option>
            {FONT_SIZE_PT.map((pt) => (
              <option key={pt} value={pt}>{pt}</option>
            ))}
          </select>
          <input
            id="font-dialog-size"
            className="font-dialog-input font-dialog-size-input"
            type="text"
            inputMode="decimal"
            value={sizeText}
            data-font-size=""
            onChange={(event) => onSizeText(event.currentTarget.value)}
            onBlur={() => onChooseSize(sizeText)}
          />
        </div>
      </div>
      <div className="font-dialog-row">
        <span className="font-dialog-label">Font color</span>
        <ColorSwatches
          colors={FONT_TEXT_COLORS}
          active={draft.textColor}
          noneLabel="Automatic"
          onPick={(color) => onPatch({ textColor: color })}
        />
      </div>
      <div className="font-dialog-row">
        <span className="font-dialog-label">Highlight</span>
        <ColorSwatches
          colors={FONT_HIGHLIGHT_COLORS}
          active={draft.highlight}
          noneLabel="None"
          onPick={(color) => onPatch({ highlight: color })}
        />
      </div>
      <label className="font-dialog-check">
        <input
          type="checkbox"
          checked={draft.underline}
          data-font-underline=""
          onChange={(event) => onPatch({ underline: event.currentTarget.checked })}
        />
        Underline
      </label>
      <fieldset className="font-dialog-effects">
        <legend className="font-dialog-section">Effects</legend>
        <label className="font-dialog-check">
          <input
            type="checkbox"
            checked={draft.strike}
            onChange={(event) => onPatch({ strike: event.currentTarget.checked })}
          />
          Strikethrough
        </label>
        <label className="font-dialog-check">
          <input
            type="checkbox"
            checked={draft.superscript}
            onChange={(event) => onPatch({
              superscript: event.currentTarget.checked,
              subscript: event.currentTarget.checked ? false : draft.subscript,
            })}
          />
          Superscript
        </label>
        <label className="font-dialog-check">
          <input
            type="checkbox"
            checked={draft.subscript}
            onChange={(event) => onPatch({
              subscript: event.currentTarget.checked,
              superscript: event.currentTarget.checked ? false : draft.superscript,
            })}
          />
          Subscript
        </label>
        <label className="font-dialog-check">
          <input
            type="checkbox"
            checked={draft.code}
            onChange={(event) => onPatch({ code: event.currentTarget.checked })}
          />
          Code
        </label>
      </fieldset>
    </div>
  );
}

function ColorSwatches({
  colors,
  active,
  noneLabel,
  onPick,
}: {
  colors: readonly string[];
  active: string | null;
  noneLabel: string;
  onPick: (color: string | null) => void;
}) {
  return (
    <div className="font-dialog-swatches" role="radiogroup">
      <button
        type="button"
        className="font-dialog-swatch font-dialog-swatch-none"
        aria-checked={active === null}
        data-checked={active === null ? 'true' : 'false'}
        onClick={() => onPick(null)}
      >
        {noneLabel}
      </button>
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          className="font-dialog-swatch"
          aria-checked={active === color}
          data-checked={active === color ? 'true' : 'false'}
          style={{ '--font-swatch-color': color } as CSSProperties}
          title={color}
          onClick={() => onPick(color)}
        />
      ))}
    </div>
  );
}

function previewStyleFromDraft(draft: FontDialogValue): CSSProperties {
  const { bold, italic } = styleParts(draft.style);
  const pt = `${draft.sizePt}pt`;
  return {
    fontFamily: `"${draft.family}", serif`,
    fontSize: pt,
    fontWeight: bold ? 700 : 400,
    fontStyle: italic ? 'italic' : 'normal',
    textDecoration: [
      draft.underline ? 'underline' : '',
      draft.strike ? 'line-through' : '',
    ].filter(Boolean).join(' ') || 'none',
    verticalAlign: draft.superscript ? 'super' : draft.subscript ? 'sub' : 'baseline',
    color: draft.textColor ?? undefined,
    backgroundColor: draft.highlight ?? undefined,
    fontVariantNumeric: 'normal',
  };
}

function styleParts(style: FontStyleId): { bold: boolean; italic: boolean } {
  switch (style) {
    case 'italic':
      return { bold: false, italic: true };
    case 'bold':
      return { bold: true, italic: false };
    case 'bold-italic':
      return { bold: true, italic: true };
    default:
      return { bold: false, italic: false };
  }
}