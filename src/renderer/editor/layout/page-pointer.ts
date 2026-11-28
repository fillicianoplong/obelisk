import type { EditorView } from 'prosemirror-view';
import {
  blockIndexAtPos,
  blockContentElement,
  blockPosAtIndex,
  dropIndexFromClientY,
  gapCenterY,
} from '../block-handle-plugin.js';

export function pagesViewActive(view: EditorView): boolean {
  return view.dom.closest('.page-canvas')?.getAttribute('data-page-view') === 'pages';
}

/** 1-based page index for a viewport Y, or null when page frames are absent. */
export function pageNumberAtClientY(view: EditorView, clientY: number): number | null {
  const frames = view.dom.ownerDocument.querySelectorAll('.page-frame[data-page]');
  for (const frame of frames) {
    if (!(frame instanceof HTMLElement)) {
      continue;
    }
    const rect = frame.getBoundingClientRect();
    if (clientY >= rect.top && clientY <= rect.bottom) {
      const page = Number(frame.dataset.page);
      return Number.isFinite(page) && page > 0 ? page : null;
    }
  }
  return null;
}

function blockOverlapsPageFrame(view: EditorView, blockIndex: number, pageNumber: number): boolean {
  const frame = view.dom.ownerDocument.querySelector(`.page-frame[data-page="${pageNumber}"]`);
  const block = blockContentElement(view, blockIndex);
  if (!(frame instanceof HTMLElement) || block === null) {
    return false;
  }
  const frameRect = frame.getBoundingClientRect();
  const blockRect = block.getBoundingClientRect();
  return blockRect.bottom > frameRect.top + 1 && blockRect.top < frameRect.bottom - 1;
}

function nearestBlockOnPage(view: EditorView, clientY: number, pageNumber: number): number | null {
  const { doc } = view.state;
  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < doc.childCount; index += 1) {
    if (!blockOverlapsPageFrame(view, index, pageNumber)) {
      continue;
    }
    const block = blockContentElement(view, index);
    if (block === null) {
      continue;
    }
    const rect = block.getBoundingClientRect();
    const distance = clientY < rect.top
      ? rect.top - clientY
      : clientY > rect.bottom
        ? clientY - rect.bottom
        : 0;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

function pointerOverBlockContentBox(
  view: EditorView,
  blockIndex: number,
  clientX: number,
  clientY: number,
): boolean {
  const blockEl = blockContentElement(view, blockIndex);
  if (blockEl === null) {
    return false;
  }
  const rect = blockEl.getBoundingClientRect();
  return clientX >= rect.left
    && clientX <= rect.right
    && clientY >= rect.top
    && clientY <= rect.bottom;
}

function blockIndexForGapClick(view: EditorView, clientY: number, clickPage: number | null): number {
  const { doc } = view.state;
  if (doc.childCount === 0) {
    return 0;
  }
  const drop = dropIndexFromClientY(view, clientY);
  const center = gapCenterY(view, drop);
  let index = center !== null && clientY < center
    ? Math.max(0, drop - 1)
    : Math.min(doc.childCount - 1, drop);
  if (clickPage !== null && !blockOverlapsPageFrame(view, index, clickPage)) {
    const near = nearestBlockOnPage(view, clientY, clickPage);
    if (near !== null) {
      index = near;
    }
  }
  return index;
}

function caretPosForBlock(view: EditorView, blockIndex: number, clientY: number): number {
  const { doc } = view.state;
  const node = doc.child(blockIndex);
  const blockPos = blockPosAtIndex(doc, blockIndex);
  const content = blockContentElement(view, blockIndex);
  if (content !== null) {
    const rect = content.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    if (clientY <= mid || !node.isTextblock) {
      return node.isTextblock ? blockPos + 1 : blockPos;
    }
    return blockPos + node.nodeSize - (node.isTextblock ? 1 : 0);
  }
  return node.isTextblock ? blockPos + 1 : blockPos;
}

export type CoordsHit = { pos: number; inside: number };

/**
 * In Pages view, clicks on page gaps must not resolve through a pagination spacer
 * to a block on the next page.
 */
export function posAtCoordsForEditor(
  view: EditorView,
  clientX: number,
  clientY: number,
): CoordsHit | null {
  let raw: CoordsHit | null = null;
  try {
    raw = view.posAtCoords({ left: clientX, top: clientY });
  } catch {
  // ProseMirror could not map the pointer. Fall back to gap geometry below.
  }
  if (!pagesViewActive(view)) {
    return raw;
  }
  const clickPage = pageNumberAtClientY(view, clientY);
  if (raw !== null) {
    const index = blockIndexAtPos(view.state.doc, raw.pos);
    const onBox = pointerOverBlockContentBox(view, index, clientX, clientY);
    const onPage = clickPage === null || blockOverlapsPageFrame(view, index, clickPage);
    if (onBox && onPage) {
      return raw;
    }
  }
  const blockIndex = blockIndexForGapClick(view, clientY, clickPage);
  return { pos: caretPosForBlock(view, blockIndex, clientY), inside: -1 };
}

export function pointerSelectionNeedsPageClamp(view: EditorView, clientX: number, clientY: number): boolean {
  if (!pagesViewActive(view)) {
    return false;
  }
  let raw: CoordsHit | null;
  try {
    raw = view.posAtCoords({ left: clientX, top: clientY });
  } catch {
    return false;
  }
  if (raw === null) {
    return false;
  }
  const resolved = posAtCoordsForEditor(view, clientX, clientY);
  return resolved !== null && resolved.pos !== raw.pos;
}