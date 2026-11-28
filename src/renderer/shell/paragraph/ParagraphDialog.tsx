import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { ParagraphDialogApply } from '../../editor/paragraph-format-commands.js';
import { ParagraphPreview } from './ParagraphPreview.js';
import {
  INDENT_FIRST_MAX_IN,
  INDENT_HANGING_MAX_IN,
  INDENT_LEFT_MAX_IN,
  INDENT_RIGHT_MAX_IN,
  INDENT_GRID_IN,
} from '../../../shared/schema/limits.js';
import {
  ALIGN_OPTIONS,
  LINE_SPACING_OPTIONS,
  SPECIAL_INDENT_OPTIONS,
  indentsFromSpecial,
  lineSpacingAtSuffix,
  paragraphDialogValueToFormat,
  snapIndentInches,
  snapSpacePt,
  type ParagraphDialogValue,
  type ParagraphApplyScope,
  type SpecialIndent,
} from './model.js';
import {
  lineSpacingRuleNeedsAt,
  snapLineSpacingAt,
  type LineSpacingRule,
} from '../../../shared/schema/line-spacing.js';
import type { ParagraphFormatValue } from '../../../shared/schema/paragraph-defaults.js';

interface ParagraphDialogProps {
  initial: ParagraphDialogValue;
  showScopeChoice: boolean;
  onCancel: () => void;
  onApply: (value: ParagraphDialogValue) => void;
  onSetDefault: (format: ParagraphFormatValue) => void;
}

export function paragraphDialogApplyOptions(value: ParagraphDialogValue): ParagraphDialogApply {
  const { indentFirst, indentHanging } = indentsFromSpecial(value.specialIndent, value.specialBy);
  const at = lineSpacingRuleNeedsAt(value.lineSpacing)
    ? snapLineSpacingAt(value.lineSpacing, value.lineSpacingAt)
    : null;
  return {
    scope: value.scope,
    lineSpacing: value.scope === 'selection' ? value.lineSpacing : undefined,
    lineSpacingAt: value.scope === 'selection' ? at : undefined,
    clearLineSpacingOverride: value.scope === 'document',
    spaceBefore: value.spaceBefore,
    spaceAfter: value.spaceAfter,
    align: value.align,
    indentLeft: value.indentLeft,
    indentRight: value.indentRight,
    indentFirst,
    indentHanging,
    dontAddSpaceBetweenSameStyle: value.dontAddSpaceBetweenSameStyle,
  };
}

export function ParagraphDialog({
  initial,
  showScopeChoice,
  onCancel,
  onApply,
  onSetDefault,
}: ParagraphDialogProps) {
  const titleId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [value, setValue] = useState<ParagraphDialogValue>(initial);

  useEffect(() => {
    setValue(initial);
    formRef.current?.querySelector<HTMLElement>('.paragraph-dialog-input')?.focus();
  }, [initial]);

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
  }

  function applyAndClose(): void {
    onApply({
      ...value,
      scope: showScopeChoice ? value.scope : 'document',
    });
  }

  const atDisabled = !lineSpacingRuleNeedsAt(value.lineSpacing);
  const byDisabled = value.specialIndent === 'none';

  return (
    <div className="paragraph-dialog-backdrop">
      <form
        ref={formRef}
        className="paragraph-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-paragraph-dialog=""
        onSubmit={submit}
        onKeyDown={(event: KeyboardEvent<HTMLFormElement>) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
      >
        <header className="paragraph-dialog-header">
          <h2 id={titleId} className="paragraph-dialog-title">Paragraph</h2>
          <button type="button" className="paragraph-dialog-close" aria-label="Close" onClick={onCancel}>
            ×
          </button>
        </header>
        <div className="paragraph-dialog-body">
          <section className="paragraph-dialog-section-block">
            <h3 className="paragraph-dialog-section">General</h3>
            <div className="paragraph-dialog-inline-row">
              <span className="paragraph-dialog-inline-label">Alignment:</span>
              <select
                className="paragraph-dialog-input paragraph-dialog-select-grow"
                value={value.align}
                onChange={(event) => setValue((current) => ({ ...current, align: event.target.value as ParagraphDialogValue['align'] }))}
              >
                {ALIGN_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </div>
          </section>
          <section className="paragraph-dialog-section-block">
            <h3 className="paragraph-dialog-section">Indentation</h3>
            <div className="paragraph-dialog-grid-row">
              <InlineSpin
                label="Left"
                suffix="in"
                value={value.indentLeft}
                step={INDENT_GRID_IN}
                max={INDENT_LEFT_MAX_IN}
                onChange={(next) => setValue((current) => ({ ...current, indentLeft: next }))}
                snap={(n) => snapIndentInches(n, INDENT_LEFT_MAX_IN)}
              />
              <label className="paragraph-dialog-inline-field">
                <span className="paragraph-dialog-inline-label">Special:</span>
                <select
                  className="paragraph-dialog-input"
                  value={value.specialIndent}
                  onChange={(event) => {
                    const specialIndent = event.target.value as SpecialIndent;
                    setValue((current) => ({
                      ...current,
                      specialIndent,
                      specialBy: specialIndent === 'none' ? 0 : current.specialBy || 0.5,
                    }));
                  }}
                >
                  {SPECIAL_INDENT_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="paragraph-dialog-grid-row">
              <InlineSpin
                label="Right"
                suffix="in"
                value={value.indentRight}
                step={INDENT_GRID_IN}
                max={INDENT_RIGHT_MAX_IN}
                onChange={(next) => setValue((current) => ({ ...current, indentRight: next }))}
                snap={(n) => snapIndentInches(n, INDENT_RIGHT_MAX_IN)}
              />
              <InlineSpin
                label="By"
                suffix="in"
                value={value.specialBy}
                step={INDENT_GRID_IN}
                max={value.specialIndent === 'hanging' ? INDENT_HANGING_MAX_IN : INDENT_FIRST_MAX_IN}
                disabled={byDisabled}
                onChange={(next) => setValue((current) => ({ ...current, specialBy: next }))}
                snap={(n) => snapIndentInches(n, value.specialIndent === 'hanging' ? INDENT_HANGING_MAX_IN : INDENT_FIRST_MAX_IN, 0)}
              />
            </div>
          </section>
          <section className="paragraph-dialog-section-block">
            <h3 className="paragraph-dialog-section">Spacing</h3>
            <div className="paragraph-dialog-grid-row">
              <InlineSpin
                label="Before"
                suffix="pt"
                value={value.spaceBefore}
                step={6}
                max={24}
                onChange={(next) => setValue((current) => ({ ...current, spaceBefore: snapSpacePt(next) }))}
                snap={snapSpacePt}
              />
              <label className="paragraph-dialog-inline-field">
                <span className="paragraph-dialog-inline-label">Line spacing:</span>
                <select
                  className="paragraph-dialog-input"
                  value={value.lineSpacing}
                  onChange={(event) => {
                    const lineSpacing = event.target.value as LineSpacingRule;
                    setValue((current) => ({
                      ...current,
                      lineSpacing,
                      lineSpacingAt: lineSpacingRuleNeedsAt(lineSpacing)
                        ? snapLineSpacingAt(lineSpacing, current.lineSpacingAt)
                        : current.lineSpacingAt,
                    }));
                  }}
                >
                  {LINE_SPACING_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="paragraph-dialog-grid-row">
              <InlineSpin
                label="After"
                suffix="pt"
                value={value.spaceAfter}
                step={6}
                max={24}
                onChange={(next) => setValue((current) => ({ ...current, spaceAfter: snapSpacePt(next) }))}
                snap={snapSpacePt}
              />
              <InlineSpin
                label="At"
                suffix={lineSpacingAtSuffix(value.lineSpacing)}
                value={value.lineSpacingAt}
                step={value.lineSpacing === 'multiple' ? 0.05 : 1}
                max={value.lineSpacing === 'multiple' ? 3 : 72}
                min={value.lineSpacing === 'multiple' ? 0.25 : 6}
                disabled={atDisabled}
                onChange={(next) => setValue((current) => ({ ...current, lineSpacingAt: next }))}
                snap={(n) => snapLineSpacingAt(value.lineSpacing, n)}
              />
            </div>
            <label className="paragraph-dialog-checkbox">
              <input
                type="checkbox"
                checked={value.dontAddSpaceBetweenSameStyle}
                onChange={(event) => setValue((current) => ({
                  ...current,
                  dontAddSpaceBetweenSameStyle: event.target.checked,
                }))}
              />
              <span>Don&apos;t add space between paragraphs of the same style</span>
            </label>
          </section>
          <section className="paragraph-dialog-section-block paragraph-dialog-preview-block">
            <h3 className="paragraph-dialog-section">Preview</h3>
            <ParagraphPreview value={value} />
          </section>
          {showScopeChoice ? (
            <section className="paragraph-dialog-section-block">
              <h3 className="paragraph-dialog-section">Apply to</h3>
              <div className="paragraph-dialog-inline-row" role="radiogroup" aria-label="Apply to">
                <label className="paragraph-dialog-radio">
                  <input
                    type="radio"
                    name="paragraph-apply-scope"
                    checked={value.scope !== 'selection'}
                    onChange={() => setValue((current) => ({ ...current, scope: 'document' as ParagraphApplyScope }))}
                  />
                  <span>Whole document</span>
                </label>
                <label className="paragraph-dialog-radio">
                  <input
                    type="radio"
                    name="paragraph-apply-scope"
                    checked={value.scope === 'selection'}
                    onChange={() => setValue((current) => ({ ...current, scope: 'selection' as ParagraphApplyScope }))}
                  />
                  <span>Selected blocks</span>
                </label>
              </div>
            </section>
          ) : null}
        </div>
        <footer className="paragraph-dialog-footer">
          <button
            type="button"
            className="paragraph-dialog-button paragraph-dialog-button-default"
            onClick={() => onSetDefault(paragraphDialogValueToFormat(value))}
          >
            Set as default
          </button>
          <div className="paragraph-dialog-footer-actions">
            <button
              type="button"
              className="paragraph-dialog-button paragraph-dialog-button-ok"
              onClick={applyAndClose}
            >
              OK
            </button>
            <button type="button" className="paragraph-dialog-button" onClick={onCancel}>Cancel</button>
          </div>
        </footer>
      </form>
    </div>
  );
}

function InlineSpin({
  label,
  suffix,
  value,
  step,
  disabled = false,
  snap,
  onChange,
}: {
  label: string;
  suffix: string;
  value: number;
  step: number;
  min?: number;
  max?: number;
  disabled?: boolean;
  snap: (n: number) => number;
  onChange: (next: number) => void;
}) {
  const text = String(value);
  return (
    <label className="paragraph-dialog-inline-field">
      <span className="paragraph-dialog-inline-label">{label}:</span>
      <span className="paragraph-dialog-field-line">
        <input
          className="paragraph-dialog-input paragraph-dialog-input-spin"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          value={text}
          aria-label={`${label} ${suffix}`}
          onChange={(event) => onChange(snap(Number.parseFloat(event.target.value)))}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              onChange(snap(value + step));
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              onChange(snap(value - step));
            }
          }}
        />
        <span className="paragraph-dialog-suffix">{suffix}</span>
      </span>
    </label>
  );
}