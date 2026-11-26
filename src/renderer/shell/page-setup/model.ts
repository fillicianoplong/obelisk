import {
  DEFAULT_MARGIN_IN,
  LENGTH_DECIMAL_PLACES,
  LETTER_HEIGHT_IN,
  LETTER_WIDTH_IN,
  MARGIN_MAX_IN,
  MARGIN_MIN_IN,
  TEXT_AREA_MIN_IN,
} from '../../../shared/schema/limits.js';

// Page setup (FR-24). Letter only. Margins stay between 0.25 and 3 inches,
// and the text area stays at least 2 inches wide and 2 inches tall.

export const MARGIN_ERROR = 'A margin must be between 0.25 and 3 inches.';
export const TEXT_WIDTH_ERROR = 'The text area must be at least 2 inches wide.';
export const TEXT_HEIGHT_ERROR = 'The text area must be at least 2 inches tall.';
export const PAPER_LABEL = 'Letter (8.5 × 11 in)';
export const PAGE_SETUP_HINT = '0.25 to 3 in';
export const MARGIN_STEP_IN = 0.25;

export type Orientation = 'portrait' | 'landscape';
export type MarginPreset = 'normal' | 'narrow' | 'wide' | 'custom';
export type MarginSide = 'top' | 'right' | 'bottom' | 'left';

export interface MarginsIn {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PageSetupValue {
  paper: 'letter';
  orientation: Orientation;
  margins: MarginsIn;
}

export interface MarginDraft {
  top: string;
  right: string;
  bottom: string;
  left: string;
}

export interface PageSetupCheck {
  ok: boolean;
  message: string | null;
  invalid: MarginSide[];
  margins: MarginsIn | null;
}

export const MARGIN_SIDES: readonly MarginSide[] = ['top', 'right', 'bottom', 'left'];

export const NORMAL_MARGINS: MarginsIn = {
  top: DEFAULT_MARGIN_IN,
  right: DEFAULT_MARGIN_IN,
  bottom: DEFAULT_MARGIN_IN,
  left: DEFAULT_MARGIN_IN,
};

export const NARROW_MARGINS: MarginsIn = {
  top: 0.5,
  right: 0.5,
  bottom: 0.5,
  left: 0.5,
};

// Wide is 1.5 in on the sides and 1 in on the top and bottom.
export const WIDE_MARGINS: MarginsIn = {
  top: DEFAULT_MARGIN_IN,
  right: 1.5,
  bottom: DEFAULT_MARGIN_IN,
  left: 1.5,
};

const MARGIN_TEXT = /^-?(?:\d+\.?\d*|\.\d+)$/;

export function paperInches(orientation: Orientation): { width: number; height: number } {
  if (orientation === 'landscape') {
    return { width: LETTER_HEIGHT_IN, height: LETTER_WIDTH_IN };
  }
  return { width: LETTER_WIDTH_IN, height: LETTER_HEIGHT_IN };
}

export function roundLength(value: number): number {
  const factor = 10 ** LENGTH_DECIMAL_PLACES;
  return Math.round(value * factor) / factor;
}

export function formatMargin(value: number): string {
  return String(roundLength(value));
}

export function parseMargin(text: string): number | null {
  const trimmed = text.trim();
  if (!MARGIN_TEXT.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export function sameMargins(left: MarginsIn, right: MarginsIn): boolean {
  return MARGIN_SIDES.every((side) => roundLength(left[side]) === roundLength(right[side]));
}

export function samePageSetup(left: PageSetupValue, right: PageSetupValue): boolean {
  return left.orientation === right.orientation && sameMargins(left.margins, right.margins);
}

export function presetForMargins(margins: MarginsIn): MarginPreset {
  if (sameMargins(margins, NORMAL_MARGINS)) {
    return 'normal';
  }
  if (sameMargins(margins, NARROW_MARGINS)) {
    return 'narrow';
  }
  if (sameMargins(margins, WIDE_MARGINS)) {
    return 'wide';
  }
  return 'custom';
}

export function marginsForPreset(preset: Exclude<MarginPreset, 'custom'>): MarginsIn {
  if (preset === 'narrow') {
    return { ...NARROW_MARGINS };
  }
  if (preset === 'wide') {
    return { ...WIDE_MARGINS };
  }
  return { ...NORMAL_MARGINS };
}

export function marginFields(margins: MarginsIn): MarginDraft {
  return {
    top: formatMargin(margins.top),
    right: formatMargin(margins.right),
    bottom: formatMargin(margins.bottom),
    left: formatMargin(margins.left),
  };
}

export function defaultPageSetup(): PageSetupValue {
  return {
    paper: 'letter',
    orientation: 'portrait',
    margins: { ...NORMAL_MARGINS },
  };
}

export function pageSetupFromUnknown(value: unknown): PageSetupValue {
  const record = value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  const orientation: Orientation = record.orientation === 'landscape' ? 'landscape' : 'portrait';
  const marginsRecord = record.margins !== null && typeof record.margins === 'object'
    ? record.margins as Record<string, unknown>
    : {};
  const side = (key: MarginSide): number => {
    const raw = marginsRecord[key];
    return typeof raw === 'number' && Number.isFinite(raw) ? roundLength(raw) : DEFAULT_MARGIN_IN;
  };
  return {
    paper: 'letter',
    orientation,
    margins: {
      top: side('top'),
      right: side('right'),
      bottom: side('bottom'),
      left: side('left'),
    },
  };
}

// An unreadable field steps from 1 in, then the result is clamped to the margin range.
export function stepMargin(text: string, delta: number): string {
  const parsed = parseMargin(text);
  const base = parsed ?? DEFAULT_MARGIN_IN;
  let next = roundLength(base + delta);
  if (next < MARGIN_MIN_IN) {
    next = MARGIN_MIN_IN;
  }
  if (next > MARGIN_MAX_IN) {
    next = MARGIN_MAX_IN;
  }
  return formatMargin(next);
}

export function pageSetupSummary(orientation: Orientation, preset: MarginPreset): string {
  const facing = orientation === 'landscape' ? 'Landscape' : 'Portrait';
  const name = preset === 'normal' ? 'Normal'
    : preset === 'narrow' ? 'Narrow'
      : preset === 'wide' ? 'Wide'
        : 'Custom';
  return `Letter · ${facing} · ${name}`;
}

export function previewMargins(draft: MarginDraft): MarginsIn {
  const side = (text: string): number => {
    const value = parseMargin(text);
    return value === null ? 0 : value;
  };
  return {
    top: side(draft.top),
    right: side(draft.right),
    bottom: side(draft.bottom),
    left: side(draft.left),
  };
}

export function checkPageSetup(
  orientation: Orientation,
  draft: MarginDraft,
  paper?: { width: number; height: number },
): PageSetupCheck {
  const invalid: MarginSide[] = [];
  const parsed: Partial<MarginsIn> = {};
  for (const side of MARGIN_SIDES) {
    const value = parseMargin(draft[side]);
    if (value === null || value < MARGIN_MIN_IN || value > MARGIN_MAX_IN) {
      invalid.push(side);
      continue;
    }
    parsed[side] = roundLength(value);
  }
  if (invalid.length > 0 || parsed.top === undefined || parsed.right === undefined || parsed.bottom === undefined || parsed.left === undefined) {
    return { ok: false, message: MARGIN_ERROR, invalid, margins: null };
  }
  const margins: MarginsIn = {
    top: parsed.top,
    right: parsed.right,
    bottom: parsed.bottom,
    left: parsed.left,
  };
  const sheet = paper ?? paperInches(orientation);
  const textWidth = sheet.width - margins.left - margins.right;
  const textHeight = sheet.height - margins.top - margins.bottom;
  if (textWidth < TEXT_AREA_MIN_IN) {
    return { ok: false, message: TEXT_WIDTH_ERROR, invalid: ['left', 'right'], margins: null };
  }
  if (textHeight < TEXT_AREA_MIN_IN) {
    return { ok: false, message: TEXT_HEIGHT_ERROR, invalid: ['top', 'bottom'], margins: null };
  }
  return { ok: true, message: null, invalid: [], margins };
}
