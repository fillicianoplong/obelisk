import { TextSelection } from 'prosemirror-state';
import type { EditorState, Transaction } from 'prosemirror-state';
import { markCloseHistoryGroup } from './history/groups.js';

const WORD_MAX = 64;

function isWordChar(char: string): boolean {
  return /[\p{L}\p{M}\p{N}'’-]/u.test(char);
}

// The word under the caret. Code blocks and inline code are left out.
export function wordAroundCaret(state: EditorState): string | null {
  const $head = state.selection.$head;
  if (!$head.parent.isTextblock || $head.parent.type.name === 'code_block') {
    return null;
  }
  const text = $head.parent.textContent;
  let offset = $head.parentOffset;
  if (offset > text.length) {
    return null;
  }
  if (offset > 0 && (offset === text.length || !isWordChar(text[offset] ?? ''))) {
    offset -= 1;
  }
  if (!isWordChar(text[offset] ?? '')) {
    return null;
  }
  let start = offset;
  let end = offset + 1;
  while (start > 0 && isWordChar(text[start - 1] ?? '')) {
    start -= 1;
  }
  while (end < text.length && isWordChar(text[end] ?? '')) {
    end += 1;
  }
  const word = text.slice(start, end);
  if (word.length < 1 || word.length > WORD_MAX) {
    return null;
  }
  const inside = state.doc.resolve($head.start() + start + 1);
  if (inside.marks().some((mark) => mark.type.name === 'code')) {
    return null;
  }
  return word;
}

function rangeCoveringCaret(state: EditorState, word: string): { from: number; to: number } | null {
  const $head = state.selection.$head;
  if (!$head.parent.isTextblock) {
    return null;
  }
  const text = $head.parent.textContent;
  const offset = $head.parentOffset;
  const origin = $head.start();
  let index = 0;
  while (index <= text.length - word.length) {
    const found = text.indexOf(word, index);
    if (found < 0) {
      return null;
    }
    const end = found + word.length;
    if (offset >= found && offset <= end) {
      return { from: origin + found, to: origin + end };
    }
    index = found + 1;
  }
  return null;
}

// Replaces the misspelled word under the caret. One transaction, so one undo step.
export function replaceSpellingSuggestion(
  state: EditorState,
  word: string,
  suggestion: string,
): Transaction | null {
  if (word.length === 0 || suggestion.length === 0 || suggestion === word) {
    return null;
  }
  const range = rangeCoveringCaret(state, word);
  if (range === null) {
    return null;
  }
  const tr = state.tr.insertText(suggestion, range.from, range.to);
  const caret = range.from + suggestion.length;
  return markCloseHistoryGroup(tr.setSelection(TextSelection.create(tr.doc, caret)));
}
