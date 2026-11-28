import type { Mark, MarkType } from 'prosemirror-model';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import {
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SIZE,
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_TEXT_COLOR,
  FONT_SIZE_PT,
} from './format/reference.js';
import { BUNDLED_FONT_FAMILIES, type BundledFontFamily } from '../../shared/fonts/manifest.js';

export type FontStyleId = 'regular' | 'italic' | 'bold' | 'bold-italic';

export interface FontDialogValue {
  family: string;
  style: FontStyleId;
  sizePt: number;
  underline: boolean;
  strike: boolean;
  superscript: boolean;
  subscript: boolean;
  code: boolean;
  textColor: string | null;
  highlight: string | null;
}

export const FONT_STYLE_LABELS: readonly { id: FontStyleId; label: string }[] = [
  { id: 'regular', label: 'Regular' },
  { id: 'italic', label: 'Italic' },
  { id: 'bold', label: 'Bold' },
  { id: 'bold-italic', label: 'Bold Italic' },
];

export const FONT_TEXT_COLORS: readonly string[] = [
  DEFAULT_TEXT_COLOR,
  '#1F2630',
  '#2563EB',
  '#15803D',
  '#9333EA',
  '#C2410C',
];

export const FONT_HIGHLIGHT_COLORS: readonly string[] = [
  DEFAULT_HIGHLIGHT_COLOR,
  '#FDE68A',
  '#BBF7D0',
  '#BFDBFE',
  '#E9D5FF',
  '#1B2838',
];

const MARK_ORDER = [
  'fontFamily',
  'fontSize',
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'superscript',
  'subscript',
  'textColor',
  'highlight',
] as const;

function markType(state: EditorState, name: string): MarkType | null {
  return state.schema.marks[name] ?? null;
}

function markPresent(marks: readonly Mark[], name: string): boolean {
  return marks.some((mark) => mark.type.name === name);
}

function markAttr(marks: readonly Mark[], name: string, attr: string): unknown {
  const mark = marks.find((entry) => entry.type.name === name);
  return mark?.attrs[attr];
}

function activeMarks(state: EditorState): readonly Mark[] {
  const { empty, from } = state.selection;
  if (!empty) {
    return state.doc.resolve(from).marks();
  }
  if (state.storedMarks !== null) {
    return state.storedMarks;
  }
  return state.doc.resolve(from).marks();
}

function styleFromMarks(marks: readonly Mark[]): FontStyleId {
  const bold = markPresent(marks, 'bold');
  const italic = markPresent(marks, 'italic');
  if (bold && italic) {
    return 'bold-italic';
  }
  if (bold) {
    return 'bold';
  }
  if (italic) {
    return 'italic';
  }
  return 'regular';
}

export function fontDialogPreviewText(state: EditorState): string {
  const { empty, from, to } = state.selection;
  if (!empty) {
    const text = state.doc.textBetween(from, to, ' ');
    if (text.trim().length > 0) {
      return text.length > 48 ? `${text.slice(0, 48)}…` : text;
    }
  }
  return 'Sample text';
}

export function fontDialogValueFromState(state: EditorState): FontDialogValue {
  const marks = activeMarks(state);
  const family = String(markAttr(marks, 'fontFamily', 'family') ?? DEFAULT_FONT_FAMILY);
  const sizeRaw = Number(markAttr(marks, 'fontSize', 'pt'));
  const sizePt = Number.isFinite(sizeRaw) && sizeRaw > 0 ? sizeRaw : DEFAULT_FONT_SIZE;
  const textColor = markAttr(marks, 'textColor', 'color');
  const highlight = markAttr(marks, 'highlight', 'color');
  return {
    family: BUNDLED_FONT_FAMILIES.some((row: BundledFontFamily) => row.family === family) ? family : DEFAULT_FONT_FAMILY,
    style: styleFromMarks(marks),
    sizePt,
    underline: markPresent(marks, 'underline'),
    strike: markPresent(marks, 'strike'),
    superscript: markPresent(marks, 'superscript'),
    subscript: markPresent(marks, 'subscript'),
    code: markPresent(marks, 'code'),
    textColor: typeof textColor === 'string' ? textColor : null,
    highlight: typeof highlight === 'string' ? highlight : null,
  };
}

function boldItalicFromStyle(style: FontStyleId): { bold: boolean; italic: boolean } {
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

function removeCharacterMarksFromTransaction(tr: Transaction, from: number, to: number): void {
  const types = tr.doc.type.schema.marks;
  for (const name of MARK_ORDER) {
    const type = types[name];
    if (type !== undefined) {
      tr.removeMark(from, to, type);
    }
  }
}

function clearStoredCharacterMarks(tr: Transaction): void {
  const types = tr.doc.type.schema.marks;
  for (const name of MARK_ORDER) {
    const type = types[name];
    if (type !== undefined) {
      tr.removeStoredMark(type);
    }
  }
}

function addDraftMarks(tr: Transaction, state: EditorState, draft: FontDialogValue): void {
  const { bold, italic } = boldItalicFromStyle(draft.style);
  const add = (name: string, attrs?: Record<string, unknown>) => {
    const type = markType(state, name);
    if (type === null) {
      return;
    }
    tr.addStoredMark(type.create(attrs));
  };
  if (draft.family !== DEFAULT_FONT_FAMILY) {
    add('fontFamily', { family: draft.family });
  }
  if (draft.sizePt !== DEFAULT_FONT_SIZE) {
    add('fontSize', { pt: draft.sizePt });
  }
  if (bold) {
    add('bold');
  }
  if (italic) {
    add('italic');
  }
  if (draft.underline) {
    add('underline');
  }
  if (draft.strike) {
    add('strike');
  }
  if (draft.code) {
    add('code');
  }
  if (draft.superscript) {
    add('superscript');
  } else if (draft.subscript) {
    add('subscript');
  }
  if (draft.textColor !== null) {
    add('textColor', { color: draft.textColor });
  }
  if (draft.highlight !== null) {
    add('highlight', { color: draft.highlight });
  }
}

function addDraftRangeMarks(
  tr: Transaction,
  state: EditorState,
  from: number,
  to: number,
  draft: FontDialogValue,
): void {
  const { bold, italic } = boldItalicFromStyle(draft.style);
  const add = (name: string, attrs?: Record<string, unknown>) => {
    const type = markType(state, name);
    if (type === null) {
      return;
    }
    tr.addMark(from, to, type.create(attrs));
  };
  removeCharacterMarksFromTransaction(tr, from, to);
  if (draft.family !== DEFAULT_FONT_FAMILY) {
    add('fontFamily', { family: draft.family });
  }
  if (draft.sizePt !== DEFAULT_FONT_SIZE) {
    add('fontSize', { pt: draft.sizePt });
  }
  if (bold) {
    add('bold');
  }
  if (italic) {
    add('italic');
  }
  if (draft.underline) {
    add('underline');
  }
  if (draft.strike) {
    add('strike');
  }
  if (draft.code) {
    add('code');
  }
  if (draft.superscript) {
    add('superscript');
  } else if (draft.subscript) {
    add('subscript');
  }
  if (draft.textColor !== null) {
    add('textColor', { color: draft.textColor });
  }
  if (draft.highlight !== null) {
    add('highlight', { color: draft.highlight });
  }
}

export function applyFontDialogCommand(draft: FontDialogValue): Command {
  return (state, dispatch) => {
    const size = Number(draft.sizePt);
    if (!Number.isFinite(size) || size <= 0) {
      return false;
    }
    const normalized = {
      ...draft,
      sizePt: (FONT_SIZE_PT as readonly number[]).includes(size) ? size : Math.round(size),
    };
    if (dispatch) {
      const tr = state.tr;
      const { empty, from, to } = state.selection;
      if (!empty) {
        addDraftRangeMarks(tr, state, from, to, normalized);
      } else {
        clearStoredCharacterMarks(tr);
        addDraftMarks(tr, state, normalized);
      }
      dispatch(tr);
    }
    return true;
  };
}

export function applyFontDialogForTest(state: EditorState, draft: FontDialogValue): EditorState | null {
  let next: EditorState | null = null;
  const applied = applyFontDialogCommand(draft)(state, (tr) => {
    next = state.apply(tr);
  });
  if (!applied || next === null) {
    return null;
  }
  return next;
}