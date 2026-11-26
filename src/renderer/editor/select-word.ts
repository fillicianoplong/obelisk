import type { Node as ProseNode } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

// A plain double-click that moves farther than this is a drag, and the
// selection follows the pointer instead of staying on the word.
export const DOUBLE_CLICK_DRAG_PX = 4;

const TRAILING_WHITESPACE = /\s+$/u;
const WORD_CHAR = /[\p{L}\p{N}\p{M}_]/u;

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

function isWordChar(text: string, index: number): boolean {
  if (index < 0 || index >= text.length) {
    return false;
  }
  return WORD_CHAR.test(text.charAt(index));
}

function isWordPart(text: string, index: number): boolean {
  if (isWordChar(text, index)) {
    return true;
  }
  const char = text.charAt(index);
  return (char === "'" || char === '\u2019')
    && isWordChar(text, index - 1)
    && isWordChar(text, index + 1);
}

/** The word at a document position, without the spaces after it. */
export function wordRangeAt(doc: ProseNode, pos: number): { from: number; to: number } | null {
  const clamped = Math.max(0, Math.min(pos, doc.content.size));
  const $pos = doc.resolve(clamped);
  if (!$pos.parent.isTextblock) {
    return null;
  }
  const text = $pos.parent.textContent;
  const origin = $pos.start();
  let index = $pos.parentOffset;
  if (!isWordPart(text, index)) {
    if (isWordPart(text, index - 1)) {
      index -= 1;
    } else {
      let cursor = index - 1;
      while (cursor >= 0 && /\s/u.test(text.charAt(cursor))) {
        cursor -= 1;
      }
      if (!isWordPart(text, cursor)) {
        return null;
      }
      index = cursor;
    }
  }
  let from = index;
  let to = index + 1;
  while (isWordPart(text, from - 1)) {
    from -= 1;
  }
  while (isWordPart(text, to)) {
    to += 1;
  }
  return { from: origin + from, to: origin + to };
}

/** The text block that holds `pos`, including a position on the boundary between blocks. */
export function textblockRangeAt(doc: ProseNode, pos: number): { from: number; to: number } | null {
  const clamped = Math.max(0, Math.min(pos, doc.content.size));
  const $pos = doc.resolve(clamped);
  if ($pos.parent.isTextblock) {
    return { from: $pos.start(), to: $pos.end() };
  }
  const before = $pos.nodeBefore;
  if (before?.isTextblock) {
    const end = $pos.pos - 1;
    return { from: end - before.content.size, to: end };
  }
  const after = $pos.nodeAfter;
  if (after?.isTextblock) {
    const start = $pos.pos + 1;
    return { from: start, to: start + after.content.size };
  }
  return null;
}

/** Grow a triple-click so the selection covers whole text blocks from the original line to the pointer. */
export function extendTextblockSelection(
  doc: ProseNode,
  origin: { from: number; to: number },
  headPos: number,
): { anchor: number; head: number } {
  const target = textblockRangeAt(doc, headPos);
  if (target === null || (target.from >= origin.from && target.to <= origin.to)) {
    return { anchor: origin.from, head: origin.to };
  }
  if (target.from < origin.from) {
    return { anchor: origin.to, head: target.from };
  }
  return { anchor: origin.from, head: target.to };
}

/** Grow a double-click by character once the pointer leaves the word. */
export function extendCharacterSelection(
  origin: { from: number; to: number },
  headPos: number,
): { anchor: number; head: number } {
  if (headPos < origin.from) {
    return { anchor: origin.to, head: headPos };
  }
  if (headPos > origin.to) {
    return { anchor: origin.from, head: headPos };
  }
  return { anchor: origin.from, head: origin.to };
}

function selectionBetween(doc: ProseNode, anchor: number, head: number): TextSelection {
  const max = doc.content.size;
  const safe = (value: number) => Math.max(0, Math.min(value, max));
  return TextSelection.between(doc.resolve(safe(anchor)), doc.resolve(safe(head)), 1) as TextSelection;
}

function applyRange(view: EditorView, anchor: number, head: number): void {
  const next = selectionBetween(view.state.doc, anchor, head);
  if (view.state.selection.eq(next)) {
    return;
  }
  const tr = view.state.tr.setSelection(next);
  tr.setMeta('pointer', true);
  view.dispatch(tr);
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
  applyRange(view, mapPos(selection.anchor), mapPos(selection.head));
  return true;
}

/** Select the word under a double-click before the browser can include the space after it. */
export function selectDoubleClickedWord(view: EditorView, pos: number): boolean {
  const range = wordRangeAt(view.state.doc, pos);
  if (range === null) {
    return false;
  }
  applyRange(view, range.from, range.to);
  return true;
}

let stopDrag: (() => void) | null = null;

export interface WordClickSession {
  onPointerDown(event: MouseEvent): void;
  onDoubleClick(view: EditorView, pos: number, event: MouseEvent): boolean;
  onPointerUp(view: EditorView, event: MouseEvent): void;
  /** Trim a double-clicked word before paint. Returns whether a trim ran. */
  onSelectionChange(view: EditorView): boolean;
}

/** One double-click path for the body, the header, and the footer. */
export function createWordClickSession(): WordClickSession {
  let gesture: { drag: boolean; range: { from: number; to: number } | null } | null = null;
  let restoreToken = 0;
  const restoreWord = (view: EditorView, range: { from: number; to: number }) => {
    if (view.isDestroyed) {
      return;
    }
    const selection = view.state.selection;
    if (
      selection instanceof TextSelection
      && selection.from === range.from
      && selection.to === range.to
    ) {
      return;
    }
    applyRange(view, range.from, range.to);
  };
  return {
    onPointerDown(event) {
      restoreToken += 1;
      if (event.button !== 0 || event.detail !== 2 || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
        gesture = null;
        return;
      }
      gesture = { drag: false, range: null };
    },
    onDoubleClick(view, pos, event) {
      if (event.button !== 0 || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
        return false;
      }
      const range = wordRangeAt(view.state.doc, pos);
      if (range === null || !selectDoubleClickedWord(view, pos)) {
        return false;
      }
      if (gesture !== null) {
        gesture.range = range;
      }
      watchSelectionDrag(view, event, 'word', range, () => {
        if (gesture !== null) {
          gesture.drag = true;
        }
      });
      return true;
    },
    onPointerUp(view, event) {
      const current = gesture;
      gesture = null;
      if (current === null || current.drag || event.button !== 0 || current.range === null) {
        return;
      }
      const range = current.range;
      const token = restoreToken;
      // A second press on a word already selected can collapse the DOM caret
      // after this handler. Put the word back once that flush has run.
      // A later press, such as the third click of a triple-click, cancels it.
      const restore = () => {
        if (token !== restoreToken) {
          return;
        }
        restoreWord(view, range);
      };
      restore();
      const win = view.dom.ownerDocument.defaultView;
      win?.queueMicrotask(restore);
      win?.requestAnimationFrame(restore);
    },
    onSelectionChange(view) {
      if (gesture === null || gesture.drag) {
        return false;
      }
      return trimDoubleClickedWord(view);
    },
  };
}

/**
 * While the button stays down after a double-click or a triple-click, follow
 * the pointer. A double-click grows by character. A triple-click grows by
 * whole text blocks. A later press-and-drag is not this gesture.
 */
export function watchSelectionDrag(
  view: EditorView,
  event: MouseEvent,
  mode: 'word' | 'line',
  origin: { from: number; to: number },
  onDrag?: () => void,
): void {
  stopDrag?.();
  const doc = view.dom.ownerDocument;
  const startX = event.clientX;
  const startY = event.clientY;
  let dragged = false;
  const stop = () => {
    doc.removeEventListener('mousemove', onMove, true);
    doc.removeEventListener('mouseup', stop, true);
    if (stopDrag === stop) {
      stopDrag = null;
    }
  };
  function onMove(move: MouseEvent) {
    if (view.isDestroyed || move.buttons === 0) {
      stop();
      return;
    }
    if (!dragged && !isDoubleClickDrag(startX, startY, move.clientX, move.clientY)) {
      return;
    }
    dragged = true;
    onDrag?.();
    move.preventDefault();
    const hit = view.posAtCoords({ left: move.clientX, top: move.clientY });
    if (hit === null) {
      return;
    }
    const next = mode === 'line'
      ? extendTextblockSelection(view.state.doc, origin, hit.pos)
      : extendCharacterSelection(origin, hit.pos);
    applyRange(view, next.anchor, next.head);
  }
  stopDrag = stop;
  doc.addEventListener('mousemove', onMove, true);
  doc.addEventListener('mouseup', stop, true);
}
