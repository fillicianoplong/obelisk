import { baseKeymap } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { EditorState, TextSelection } from 'prosemirror-state';
import type { Command, Selection, Transaction } from 'prosemirror-state';
import { editorSchema } from './schema.js';

function applyCommand(state: EditorState, command: Command): EditorState | null {
  let next: EditorState | null = null;
  const applied = command(state, (transaction: Transaction) => {
    next = state.apply(transaction);
  });
  if (!applied || next === null) {
    return null;
  }
  return next;
}

export function createTabEditorState(): EditorState {
  return EditorState.create({
    schema: editorSchema,
    plugins: [
      history(),
      keymap({
        'Mod-z': undo,
        'Mod-y': redo,
        'Shift-Mod-z': redo,
      }),
      keymap(baseKeymap),
    ],
  });
}

export function editorText(state: EditorState): string {
  return state.doc.textBetween(0, state.doc.content.size, '\n');
}

export interface EditorCaret {
  anchor: number;
  head: number;
}

export function editorCaret(state: EditorState): EditorCaret {
  return {
    anchor: state.selection.anchor,
    head: state.selection.head,
  };
}

export interface ParagraphCaret {
  paragraph: number;
  offset: number;
}

export function paragraphCaret(state: EditorState): ParagraphCaret {
  const head = state.selection.$head;
  return {
    paragraph: head.depth === 0 ? 0 : head.index(0),
    offset: head.parentOffset,
  };
}

export function paragraphPosition(state: EditorState, paragraph: number, offset: number): number {
  if (paragraph < 0 || paragraph >= state.doc.childCount) {
    throw new RangeError(`paragraph ${paragraph} is outside the document`);
  }
  let start = 0;
  for (let index = 0; index < paragraph; index += 1) {
    start += state.doc.child(index).nodeSize;
  }
  const block = state.doc.child(paragraph);
  const clamped = Math.max(0, Math.min(offset, block.content.size));
  return start + 1 + clamped;
}

// A focus event can park the caret at the start or end of the document
// without a click, key, or composition. That selection is not user input.
export function isUnpromptedEdgeSelection(transaction: Transaction, selection: Selection): boolean {
  if (transaction.docChanged || !transaction.selectionSet) {
    return false;
  }
  if (transaction.getMeta('pointer') || transaction.scrolledIntoView) {
    return false;
  }
  if (transaction.getMeta('composition') != null || transaction.getMeta('uiEvent') != null) {
    return false;
  }
  if (transaction.selection.eq(selection)) {
    return false;
  }
  const { doc } = transaction;
  return transaction.selection.eq(TextSelection.atStart(doc))
    || transaction.selection.eq(TextSelection.atEnd(doc));
}

export function insertText(state: EditorState, text: string): EditorState {
  return state.apply(state.tr.insertText(text));
}

export function setCaret(state: EditorState, position: number): EditorState {
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, position)));
}

export function undoLastChange(state: EditorState): EditorState | null {
  return applyCommand(state, undo);
}

export function redoLastChange(state: EditorState): EditorState | null {
  return applyCommand(state, redo);
}
