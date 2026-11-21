import { TextSelection } from 'prosemirror-state';
import type { EditorState, Transaction } from 'prosemirror-state';
import { markCloseHistoryGroup } from './history/groups.js';

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
