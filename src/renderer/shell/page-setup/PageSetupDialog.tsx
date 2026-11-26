import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  MARGIN_STEP_IN,
  PAGE_SETUP_HINT,
  PAPER_LABEL,
  checkPageSetup,
  marginFields,
  marginsForPreset,
  pageSetupSummary,
  paperInches,
  presetForMargins,
  previewMargins,
  stepMargin,
  type MarginDraft,
  type MarginPreset,
  type MarginSide,
  type Orientation,
  type PageSetupValue,
} from './model.js';

interface PageSetupDialogProps {
  initial: PageSetupValue;
  onCancel: () => void;
  onApply: (page: PageSetupValue) => void;
}

const FIELD_ORDER: readonly MarginSide[] = ['top', 'bottom', 'left', 'right'];

const PRESETS: readonly { id: MarginPreset; label: string }[] = [
  { id: 'normal', label: 'Normal' },
  { id: 'narrow', label: 'Narrow' },
  { id: 'wide', label: 'Wide' },
  { id: 'custom', label: 'Custom' },
];

const FIELD_LABEL: Record<MarginSide, string> = {
  top: 'Top',
  right: 'Right',
  bottom: 'Bottom',
  left: 'Left',
};

export function PageSetupDialog({ initial, onCancel, onApply }: PageSetupDialogProps) {
  const titleId = useId();
  const hintId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [orientation, setOrientation] = useState<Orientation>(initial.orientation);
  const [preset, setPreset] = useState<MarginPreset>(presetForMargins(initial.margins));
  const [fields, setFields] = useState<MarginDraft>(marginFields(initial.margins));
  const check = checkPageSetup(orientation, fields);

  useEffect(() => {
    const selected = formRef.current?.querySelector<HTMLInputElement>('input[name="page-orientation"]:checked');
    selected?.focus();
  }, []);

  function choosePreset(next: MarginPreset): void {
    setPreset(next);
    if (next === 'custom') {
      return;
    }
    setFields(marginFields(marginsForPreset(next)));
  }

  function editField(side: MarginSide, text: string): void {
    const next = { ...fields, [side]: text };
    setFields(next);
    const parsed = checkPageSetup(orientation, next);
    if (parsed.margins === null) {
      setPreset('custom');
      return;
    }
    setPreset(presetForMargins(parsed.margins));
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!check.ok || check.margins === null) {
      return;
    }
    onApply({
      paper: 'letter',
      orientation,
      margins: check.margins,
    });
  }

  return (
    <div className="page-setup-backdrop">
      <form
        ref={formRef}
        className="page-setup-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={check.message !== null ? hintId : undefined}
        data-page-setup=""
        data-page-setup-valid={check.ok ? 'true' : 'false'}
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
      >
        <h2 id={titleId} className="page-setup-title">Page setup</h2>
        <div className="page-setup-body">
          <div className="page-setup-fields-column">
            <div className="page-setup-block">
              <h3 className="page-setup-section">Paper</h3>
              <p className="page-setup-paper" data-page-paper="">{PAPER_LABEL}</p>
            </div>
            <div className="page-setup-block">
              <h3 className="page-setup-section" id="page-setup-orientation">Orientation</h3>
              <div className="page-setup-orientations" role="radiogroup" aria-labelledby="page-setup-orientation">
                <OrientationCard
                  value="portrait"
                  label="Portrait"
                  checked={orientation === 'portrait'}
                  onSelect={() => setOrientation('portrait')}
                />
                <OrientationCard
                  value="landscape"
                  label="Landscape"
                  checked={orientation === 'landscape'}
                  onSelect={() => setOrientation('landscape')}
                />
              </div>
            </div>
            <div className="page-setup-block">
              <h3 className="page-setup-section" id="page-setup-margins">Margins</h3>
              <div className="page-setup-presets" role="radiogroup" aria-labelledby="page-setup-margins">
                {PRESETS.map((item) => (
                  <label key={item.id} className="page-setup-preset">
                    <input
                      type="radio"
                      name="page-margins"
                      value={item.id}
                      checked={preset === item.id}
                      data-preset={item.id}
                      onChange={() => choosePreset(item.id)}
                    />
                    {item.label}
                  </label>
                ))}
              </div>
              <div className="page-setup-inches-grid">
                {FIELD_ORDER.map((side) => (
                  <MarginField
                    key={side}
                    side={side}
                    value={fields[side]}
                    invalid={check.invalid.includes(side)}
                    describedBy={hintId}
                    onChange={(text) => editField(side, text)}
                    onStep={(delta) => editField(side, stepMargin(fields[side], delta))}
                  />
                ))}
              </div>
              <p
                id={hintId}
                className={check.message !== null ? 'page-setup-error' : 'page-setup-hint'}
                role={check.message !== null ? 'alert' : undefined}
                data-page-setup-message=""
              >
                {check.message ?? PAGE_SETUP_HINT}
              </p>
            </div>
          </div>
          <Preview orientation={orientation} preset={preset} fields={fields} />
        </div>
        <div className="page-setup-actions">
          <button
            type="submit"
            className="page-setup-button page-setup-button-ok"
            data-page-ok=""
            disabled={!check.ok}
          >
            OK
          </button>
          <button
            type="button"
            className="page-setup-button"
            data-page-cancel=""
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function OrientationCard({
  value,
  label,
  checked,
  onSelect,
}: {
  value: Orientation;
  label: string;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <label className="page-setup-card">
      <input
        type="radio"
        name="page-orientation"
        value={value}
        checked={checked}
        data-orientation-choice={value}
        onChange={onSelect}
      />
      <span className="page-setup-thumb" data-orientation={value} aria-hidden="true" />
      <span className="page-setup-card-label">{label}</span>
    </label>
  );
}

function MarginField({
  side,
  value,
  invalid,
  describedBy,
  onChange,
  onStep,
}: {
  side: MarginSide;
  value: string;
  invalid: boolean;
  describedBy: string;
  onChange: (text: string) => void;
  onStep: (delta: number) => void;
}) {
  return (
    <label className="page-setup-field">
      <span className="page-setup-field-label">{FIELD_LABEL[side]}</span>
      <span className="page-setup-field-line">
        <input
          className="page-setup-input"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={value}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          data-margin={side}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') {
              return;
            }
            event.preventDefault();
            onStep(event.key === 'ArrowUp' ? MARGIN_STEP_IN : -MARGIN_STEP_IN);
          }}
        />
        <span className="page-setup-suffix" aria-hidden="true">in</span>
      </span>
    </label>
  );
}

function Preview({
  orientation,
  preset,
  fields,
}: {
  orientation: Orientation;
  preset: MarginPreset;
  fields: MarginDraft;
}) {
  const paper = paperInches(orientation);
  const margins = previewMargins(fields);
  const box = {
    top: (margins.top / paper.height) * 100,
    right: (margins.right / paper.width) * 100,
    bottom: (margins.bottom / paper.height) * 100,
    left: (margins.left / paper.width) * 100,
  };
  return (
    <div className="page-setup-preview" aria-hidden="true">
      <div className="page-setup-well">
        <div className="page-setup-sheet" data-orientation={orientation} data-page-preview="">
          <div
            className="page-setup-margin"
            style={{
              top: `${box.top}%`,
              right: `${box.right}%`,
              bottom: `${box.bottom}%`,
              left: `${box.left}%`,
            }}
          >
            <div className="page-setup-lines">
              {Array.from({ length: 7 }, (_, index) => <span key={index} />)}
            </div>
          </div>
        </div>
      </div>
      <p className="page-setup-caption">
        Letter
        <br />
        {pageSetupSummary(orientation, preset)}
      </p>
    </div>
  );
}
