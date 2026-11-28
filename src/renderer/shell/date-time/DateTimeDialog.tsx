import { useEffect, useId, useRef, useState } from 'react';
import { DATE_CHIP_FORMATS } from '../../../shared/schema/limits.js';
import {
  DATE_CHIP_FORMAT_LABELS,
  dateTimeFromFields,
  formatDateTime,
  parseDateTime,
  partsToDateInput,
  partsToTimeInput,
  type DateChipFormat,
} from '../../../shared/date-time/format.js';
import type { DateTimeDraft } from '../../editor/date-time/commands.js';

interface DateTimeDialogProps {
  draft: DateTimeDraft;
  onCancel: () => void;
  onSubmit: (dateTime: string, format: DateChipFormat) => string | null;
}

export function DateTimeDialog({ draft, onCancel, onSubmit }: DateTimeDialogProps) {
  const titleId = useId();
  const dateId = useId();
  const timeId = useId();
  const formatId = useId();
  const previewId = useId();
  const errorId = useId();
  const dateRef = useRef<HTMLInputElement>(null);
  const formatRef = useRef<HTMLSelectElement>(null);
  const initialParts = parseDateTime(draft.dateTime);
  const [dateValue, setDateValue] = useState(initialParts ? partsToDateInput(initialParts) : '');
  const [timeValue, setTimeValue] = useState(initialParts ? partsToTimeInput(initialParts) : '12:00');
  const [format, setFormat] = useState<DateChipFormat>(draft.format);
  const [error, setError] = useState<string | null>(null);
  const title = draft.mode === 'edit'
    ? 'Edit date and time'
    : draft.mode === 'format'
      ? 'Change format'
      : 'Date and time';
  const formatOnly = draft.mode === 'format';

  useEffect(() => {
    const field = formatOnly ? formatRef.current : dateRef.current;
    field?.focus();
  }, [formatOnly]);

  const previewDateTime = dateTimeFromFields(dateValue, timeValue) ?? draft.dateTime;
  const preview = formatDateTime(previewDateTime, format);

  function submit(): void {
    if (formatOnly) {
      const failure = onSubmit(draft.dateTime, format);
      if (failure !== null) {
        setError(failure);
      }
      return;
    }
    const stored = dateTimeFromFields(dateValue, timeValue);
    if (stored === null) {
      setError('Choose a real date and time.');
      dateRef.current?.focus();
      return;
    }
    const failure = onSubmit(stored, format);
    if (failure !== null) {
      setError(failure);
      dateRef.current?.focus();
    }
  }

  return (
    <div className="date-time-dialog-backdrop">
      <form
        className="date-time-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={error !== null ? errorId : previewId}
        data-date-time-dialog={draft.mode}
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
        <h2 id={titleId} className="date-time-dialog-title">{title}</h2>
        <div className="date-time-dialog-body">
          {!formatOnly ? (
            <>
              <label className="date-time-dialog-label" htmlFor={dateId}>Date</label>
              <input
                id={dateId}
                ref={dateRef}
                className="date-time-dialog-input"
                type="date"
                value={dateValue}
                data-date-time-date=""
                onChange={(event) => {
                  setDateValue(event.target.value);
                  setError(null);
                }}
              />
              <label className="date-time-dialog-label" htmlFor={timeId}>Time</label>
              <input
                id={timeId}
                className="date-time-dialog-input"
                type="time"
                value={timeValue}
                data-date-time-time=""
                onChange={(event) => {
                  setTimeValue(event.target.value);
                  setError(null);
                }}
              />
            </>
          ) : null}
          <label className="date-time-dialog-label" htmlFor={formatId}>Format</label>
          <select
            id={formatId}
            ref={formatRef}
            className="date-time-dialog-input date-time-dialog-select"
            value={format}
            data-date-time-format=""
            onChange={(event) => {
              setFormat(event.target.value as DateChipFormat);
              setError(null);
            }}
          >
            {DATE_CHIP_FORMATS.map((entry) => (
              <option key={entry} value={entry}>{DATE_CHIP_FORMAT_LABELS[entry]}</option>
            ))}
          </select>
          <p id={previewId} className="date-time-dialog-preview" data-date-time-preview="">{preview}</p>
          {error !== null ? (
            <p id={errorId} className="date-time-dialog-error" role="alert">{error}</p>
          ) : null}
        </div>
        <div className="date-time-dialog-actions">
          <button type="submit" className="date-time-dialog-button date-time-dialog-button-ok" data-date-time-ok="">
            OK
          </button>
          <button
            type="button"
            className="date-time-dialog-button"
            data-date-time-cancel=""
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}