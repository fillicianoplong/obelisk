import { toggleMark } from 'prosemirror-commands';
import type { MarkType } from 'prosemirror-model';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import {
  DEFAULT_FONT_SIZE,
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_TEXT_COLOR,
  FONT_SIZE_PT,
  fontFamilyFromMenuId,
  fontSizeFromMenuId,
} from './format/reference.js';
import { editorSchema } from './schema/index.js';

const CHARACTER_MARK_TYPES = [
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'superscript',
  'subscript',
  'fontFamily',
  'fontSize',
  'textColor',
  'highlight',
] as const;

type CharacterMarkName = typeof CHARACTER_MARK_TYPES[number];

function markType(name: CharacterMarkName): MarkType {
  return editorSchema.marks[name];
}

function applyCommand(state: EditorState, command: Command): EditorState | null {
  let next: EditorState | null = null;
  const applied = command(state, (tr) => {
    next = state.apply(tr);
  });
  if (!applied || next === null) {
    return null;
  }
  return next;
}

function toggleNamedMark(name: CharacterMarkName): Command {
  return toggleMark(markType(name));
}

function setMark(name: CharacterMarkName, attrs: Record<string, unknown>): Command {
  const type = markType(name);
  return (state, dispatch) => {
    const { empty, from, to } = state.selection;
    if (empty) {
      return false;
    }
    if (dispatch) {
      dispatch(state.tr.addMark(from, to, type.create(attrs)));
    }
    return true;
  };
}

function removeCharacterMarks(tr: Transaction, from: number, to: number): void {
  for (const name of CHARACTER_MARK_TYPES) {
    tr.removeMark(from, to, markType(name));
  }
}

function clearFormattingCommand(): Command {
  return (state, dispatch) => {
    const { empty, from, to } = state.selection;
    if (empty) {
      return false;
    }
    if (dispatch) {
      const tr = state.tr;
      removeCharacterMarks(tr, from, to);
      dispatch(tr);
    }
    return true;
  };
}

export function clearCharacterFormatting(state: EditorState): EditorState | null {
  const { from, to, empty } = state.selection;
  if (empty) {
    return null;
  }
  const tr = state.tr;
  removeCharacterMarks(tr, from, to);
  return state.apply(tr);
}

function stepFontSizeCommand(larger: boolean): Command {
  return (state, dispatch) => {
    const { empty, from, to } = state.selection;
    if (empty) {
      return false;
    }
    const current = markType('fontSize').isInSet(state.doc.resolve(from).marks());
    const currentPt = current ? Number(current.attrs.pt) : DEFAULT_FONT_SIZE;
    let index = FONT_SIZE_PT.indexOf(currentPt as (typeof FONT_SIZE_PT)[number]);
    if (index < 0) {
      index = FONT_SIZE_PT.indexOf(DEFAULT_FONT_SIZE);
    }
    const nextIndex = larger ? Math.min(index + 1, FONT_SIZE_PT.length - 1) : Math.max(index - 1, 0);
    if (nextIndex === index) {
      return false;
    }
    const next = FONT_SIZE_PT[nextIndex];
    const tr = state.tr;
    tr.removeMark(from, to, markType('fontSize'));
    if (next !== DEFAULT_FONT_SIZE) {
      tr.addMark(from, to, markType('fontSize').create({ pt: next }));
    }
    if (dispatch) {
      dispatch(tr);
    }
    return true;
  };
}

export function stepFontSize(state: EditorState, larger: boolean): EditorState | null {
  return applyCommand(state, stepFontSizeCommand(larger));
}

export function formatMenuCommand(menuId: string): Command | null {
  if (menuId === 'format-clear') {
    return clearFormattingCommand();
  }
  const font = fontFamilyFromMenuId(menuId);
  if (font !== null) {
    return setMark('fontFamily', { family: font });
  }
  const size = fontSizeFromMenuId(menuId);
  if (size !== null) {
    return setMark('fontSize', { pt: size });
  }
  const toggles: Record<string, CharacterMarkName> = {
    'format-bold': 'bold',
    'format-italic': 'italic',
    'format-underline': 'underline',
    'format-strikethrough': 'strike',
    'format-superscript': 'superscript',
    'format-subscript': 'subscript',
    'format-code': 'code',
  };
  const markName = toggles[menuId];
  if (markName !== undefined) {
    return toggleNamedMark(markName);
  }
  if (menuId === 'format-text-color') {
    return setMark('textColor', { color: DEFAULT_TEXT_COLOR });
  }
  if (menuId === 'format-highlight') {
    return setMark('highlight', { color: DEFAULT_HIGHLIGHT_COLOR });
  }
  return null;
}

export function runFormatMenuCommand(state: EditorState, menuId: string): EditorState | null {
  const command = formatMenuCommand(menuId);
  if (command === null) {
    return null;
  }
  return applyCommand(state, command);
}

export function applyCharacterMarksCommand(marks: Record<string, unknown>): Command {
  return (state, dispatch) => {
    const { empty, from, to } = state.selection;
    if (empty) {
      return false;
    }
    const tr = state.tr;
    if (marks.bold) {
      tr.addMark(from, to, markType('bold').create());
    }
    if (marks.italic) {
      tr.addMark(from, to, markType('italic').create());
    }
    if (marks.underline) {
      tr.addMark(from, to, markType('underline').create());
    }
    if (marks.strike) {
      tr.addMark(from, to, markType('strike').create());
    }
    if (marks.code) {
      tr.addMark(from, to, markType('code').create());
    }
    if (marks.superscript) {
      tr.addMark(from, to, markType('superscript').create());
    }
    if (marks.subscript) {
      tr.addMark(from, to, markType('subscript').create());
    }
    if (typeof marks.font === 'string') {
      tr.addMark(from, to, markType('fontFamily').create({ family: marks.font }));
    }
    if (typeof marks.size === 'number') {
      tr.addMark(from, to, markType('fontSize').create({ pt: marks.size }));
    }
    if (typeof marks.color === 'string') {
      tr.addMark(from, to, markType('textColor').create({ color: marks.color }));
    }
    if (typeof marks.highlight === 'string') {
      tr.addMark(from, to, markType('highlight').create({ color: marks.highlight }));
    }
    if (dispatch) {
      dispatch(tr);
    }
    return true;
  };
}

export function applyCharacterMarksForTest(
  state: EditorState,
  marks: Record<string, unknown>,
): EditorState | null {
  return applyCommand(state, applyCharacterMarksCommand(marks));
}

export function editorFormatKeymap(): Record<string, Command> {
  return {
    'Mod-b': toggleNamedMark('bold'),
    'Mod-i': toggleNamedMark('italic'),
    'Mod-u': toggleNamedMark('underline'),
    'Mod-Shift-x': toggleNamedMark('strike'),
    'Mod-Space': clearFormattingCommand(),
    'Mod-\\': clearFormattingCommand(),
    'Mod-Shift->': stepFontSizeCommand(true),
    'Mod-Shift-<': stepFontSizeCommand(false),
  };
}
