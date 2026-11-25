import type { Node as ProseNode } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

// A plain double-click that moves farther than this is a drag, and the
// selection is left as the pointer drew it.
export const DOUBLE_CLICK_DRAG_PX = 4;

const TRAILING_WHITESPACE = /\s+$/u;

/**
 * The browser's double-click selects the word and the spaces after it.
 * Drop those spaces. Punctuation stays, and a selection that crosses
 * blocks (a drag, or a triple-click that the caller should not send here)
 * is left alone.
 */
export function selectionWithoutTrailingSpace(
  doc: ProseNode,
  from: number,
  to: number,
): { from: number; to: number } | null {
  if (to <= from) {
    return null;
  }
  const start = doc.resolve(from);
  const end = doc.resolve(to);
  if (!start.parent.isTextblock || start.parent !== end.parent) {
    return null;
  }
  const text = doc.textBetween(from, to, '', '');
  if (text.length !== to - from) {
    return null;
  }
  const trailing = TRAILING_WHITESPACE.exec(text);
  if (trailing === null || trailing[0].length === 0 || trailing[0].length === text.length) {
    return null;
  }
  return { from, to: to - trailing[0].length };
}

export function isDoubleClickDrag(startX: number, startY: number, endX: number, endY: number): boolean {
  return Math.abs(endX - startX) > DOUBLE_CLICK_DRAG_PX
    || Math.abs(endY - startY) > DOUBLE_CLICK_DRAG_PX;
}

/** Shrink a double-clicked word so the space after it is not selected. */
export function trimDoubleClickedWord(view: EditorView): boolean {
  const selection = view.state.selection;
  if (!(selection instanceof TextSelection) || selection.empty) {
    return false;
  }
  const trimmed = selectionWithoutTrailingSpace(view.state.doc, selection.from, selection.to);
  if (trimmed === null) {
    return false;
  }
  const mapPos = (pos: number) => (pos === selection.to ? trimmed.to : pos);
  const tr = view.state.tr.setSelection(TextSelection.create(
    view.state.doc,
    mapPos(selection.anchor),
    mapPos(selection.head),
  ));
  // The trim follows the click, so it is not an unprompted caret jump.
  tr.setMeta('pointer', true);
  view.dispatch(tr);
  return true;
}
