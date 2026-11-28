import { Decoration, DecorationSet } from 'prosemirror-view';
import type { EditorView } from 'prosemirror-view';
import type { Node as ProseNode } from 'prosemirror-model';
import { NodeSelection, Selection, TextSelection } from 'prosemirror-state';
import { Plugin, PluginKey } from 'prosemirror-state';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import { effectiveLineSpacing, isLineSpacing } from '../../shared/schema/line-spacing.js';
import { blockMoveKeymap, moveBlockRangeToDropCommand } from './block-move-commands.js';
import { resetPageFocusToPointer } from '../shell/page-focus.js';
import { watchOutsidePress } from '../shell/outside-press.js';
import {
  applyBlockMenuAction,
  blockMenuOptionIds,
  createBlockMenu,
  createGripTooltip,
  createGutterButton,
  emptyBlockHintDecoration,
  GRIP_TOOLTIP_HOVER_MS,
  insertEmptyBlockWithSlashMenu,
  paintBlockMenu,
  slashMenuOpenWithoutSlash,
} from './block-gutter.js';

export interface BlockDragState {
  sourceFrom: number;
  sourceTo: number;
  dropIndex: number | null;
}

export interface BlockHandleState {
  /** Block index for Shift+click range anchor. */
  anchor: number | null;
  from: number | null;
  to: number | null;
  drag: BlockDragState | null;
  /** Top-level block index showing the hover handle, if any. */
  hoverBlock: number | null;
  /** Keep the hover handle visible while the pointer is on the handle grip. */
  hoverPinned: boolean;
}

export const blockHandlePluginKey = new PluginKey<BlockHandleState>('blockHandle');

export function emptyBlockHandleState(): BlockHandleState {
  return { anchor: null, from: null, to: null, drag: null, hoverBlock: null, hoverPinned: false };
}

export function blockHoverIndex(state: EditorState): number | null {
  return blockHandleState(state).hoverBlock;
}

export function blockHandleState(state: EditorState): BlockHandleState {
  return blockHandlePluginKey.getState(state) ?? emptyBlockHandleState();
}

export function blockIndexAtPos(doc: ProseNode, pos: number): number {
  const resolved = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  return resolved.index(0);
}

export function caretBlockIndex(state: EditorState): number {
  if (state.selection instanceof NodeSelection && state.selection.$anchor.depth === 0) {
    return state.selection.$anchor.index(0);
  }
  return state.selection.$from.index(0);
}

export function blockPosAtIndex(doc: ProseNode, blockIndex: number): number {
  let pos = 0;
  for (let index = 0; index < blockIndex; index += 1) {
    pos += doc.child(index).nodeSize;
  }
  return pos;
}

export function selectedBlockRange(state: EditorState): { from: number; to: number } | null {
  const { from, to } = blockHandleState(state);
  if (from === null || to === null) {
    return null;
  }
  return { from: Math.min(from, to), to: Math.max(from, to) };
}

export function selectedBlockCount(state: EditorState): number {
  const range = selectedBlockRange(state);
  if (range === null) {
    return 0;
  }
  return range.to - range.from + 1;
}

function setBlockHandleState(
  tr: Transaction,
  next: BlockHandleState,
): Transaction {
  return tr.setMeta(blockHandlePluginKey, next);
}

function clampHoverBlock(doc: ProseNode, hoverBlock: number | null): number | null {
  if (hoverBlock === null) {
    return null;
  }
  if (hoverBlock < 0 || hoverBlock >= doc.childCount) {
    return null;
  }
  return hoverBlock;
}

function dispatchHover(
  view: EditorView,
  hoverBlock: number | null,
  hoverPinned: boolean,
): void {
  const current = blockHandleState(view.state);
  const nextHover = hoverBlock === null ? null : clampHoverBlock(view.state.doc, hoverBlock);
  if (current.hoverBlock === nextHover && current.hoverPinned === hoverPinned) {
    return;
  }
  view.dispatch(setBlockHandleState(view.state.tr, {
    ...current,
    hoverBlock: nextHover,
    hoverPinned,
  }));
}

export function setBlockHandleHover(view: EditorView, blockIndex: number | null): void {
  dispatchHover(view, blockIndex, blockIndex !== null);
}

/**
 * While a block menu is open, the add and grip controls stay on its block.
 * The pointer moving over other blocks or off the page does not move or hide them.
 */
const blockMenuLocks = new WeakMap<EditorView, number>();
/** Which menu holds the lock: the grip menu, a right-click menu, or the slash menu opened from +. */
export type BlockMenuLockOwner = 'grip' | 'context' | 'slash';
interface BlockMenuLockInfo {
  owner: BlockMenuLockOwner;
  /** The control that opened the menu keeps its pressed look: grip or add. */
  control: 'grip' | 'add' | null;
}
const blockMenuLockInfo = new WeakMap<EditorView, BlockMenuLockInfo>();
const blockMenuSyncs = new WeakMap<EditorView, (view: EditorView) => void>();

export function blockMenuLockIndex(view: EditorView): number | null {
  const index = blockMenuLocks.get(view);
  return index === undefined ? null : index;
}

export function blockMenuLockOwner(view: EditorView): BlockMenuLockOwner | null {
  return blockMenuLockInfo.get(view)?.owner ?? null;
}

function clearBlockMenuLock(view: EditorView): void {
  blockMenuLocks.delete(view);
  blockMenuLockInfo.delete(view);
}

export function lockBlockMenuGutter(
  view: EditorView,
  blockIndex: number | null,
  owner: BlockMenuLockOwner = 'grip',
  control: 'grip' | 'add' | null = owner === 'slash' ? 'add' : 'grip',
): void {
  if (view.isDestroyed) {
    return;
  }
  const current = blockMenuLockInfo.get(view);
  if (blockIndex === null) {
    // Only the menu that took the lock can release it.
    if (!blockMenuLocks.has(view) || current?.owner !== owner) {
      return;
    }
    clearBlockMenuLock(view);
    dispatchHover(view, null, false);
    blockMenuSyncs.get(view)?.(view);
    return;
  }
  const index = clampHoverBlock(view.state.doc, blockIndex);
  if (index === null) {
    return;
  }
  blockMenuLocks.set(view, index);
  blockMenuLockInfo.set(view, { owner, control });
  dispatchHover(view, index, true);
  blockMenuSyncs.get(view)?.(view);
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

function pointerInBlockHandleHit(
  view: EditorView,
  blockIndex: number,
  clientX: number,
  clientY: number,
): boolean {
  const layer = view.dom.ownerDocument.querySelector('.block-handle-layer');
  if (!(layer instanceof HTMLElement)) {
    return false;
  }
  const handle = layer.querySelector(`.block-handle[data-block-index="${blockIndex}"]`);
  if (!(handle instanceof HTMLElement) || handle.hidden) {
    return false;
  }
  const rect = handle.getBoundingClientRect();
  return clientX >= rect.left
    && clientX <= rect.right
    && clientY >= rect.top
    && clientY <= rect.bottom;
}

function hoverBlockIndexFromPointer(view: EditorView, event: MouseEvent): number | null {
  const index = blockIndexFromPointer(view, event);
  if (index !== null && pointerOverBlockContentBox(view, index, event.clientX, event.clientY)) {
    return index;
  }
  const current = blockHandleState(view.state).hoverBlock;
  if (current !== null && pointerInBlockHandleHit(view, current, event.clientX, event.clientY)) {
    return current;
  }
  return null;
}

function blockIndexFromPointer(view: EditorView, event: MouseEvent): number | null {
  if (!(event.target instanceof HTMLElement)) {
    return null;
  }
  if (event.target.closest('.block-handle') !== null) {
    return null;
  }
  if (!view.dom.contains(event.target)) {
    return null;
  }
  const { doc } = view.state;
  if (doc.childCount === 0) {
    return null;
  }
  try {
    const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
    if (hit !== null) {
      const index = blockIndexAtPos(doc, hit.pos);
      if (index >= doc.childCount) {
        return doc.childCount - 1;
      }
      return index;
    }
  } catch {
    // Fall through to geometry.
  }
  const drop = dropIndexFromClientY(view, event.clientY);
  return drop >= doc.childCount ? doc.childCount - 1 : drop;
}

function selectBlocks(
  tr: Transaction,
  from: number,
  to: number,
  anchor: number,
  prior: BlockHandleState,
): Transaction {
  const doc = tr.doc;
  const start = Math.max(0, Math.min(from, to));
  const end = Math.min(doc.childCount - 1, Math.max(from, to));
  const nodePos = blockPosAtIndex(doc, start);
  return setBlockHandleState(
    tr.setSelection(NodeSelection.create(doc, nodePos)).setMeta('blockHandleKeep', true),
    { ...prior, anchor, from: start, to: end, drag: null },
  );
}

export function selectBlockByIndex(
  state: EditorState,
  blockIndex: number,
  extend: boolean,
): Transaction | null {
  if (blockIndex < 0 || blockIndex >= state.doc.childCount) {
    return null;
  }
  const current = blockHandleState(state);
  if (extend && current.anchor !== null) {
    return selectBlocks(state.tr, current.anchor, blockIndex, current.anchor, current);
  }
  return selectBlocks(state.tr, blockIndex, blockIndex, blockIndex, current);
}

function editorContentHasFocus(view: EditorView): boolean {
  if (view.hasFocus()) {
    return true;
  }
  const active = view.dom.ownerDocument.activeElement;
  if (active === view.dom || (active != null && view.dom.contains(active))) {
    return true;
  }
  const host = view.dom.parentElement;
  if (host != null && active != null && (active === host || host.contains(active))) {
    return true;
  }
  const { body } = view.dom.ownerDocument;
  if ((active == null || active === body) && view.dom.isConnected) {
    return true;
  }
  return false;
}

export function escapeSelectsCaretBlock(state: EditorState, view?: EditorView): boolean {
  if (view !== undefined && !editorContentHasFocus(view)) {
    return false;
  }
  if (!(state.selection instanceof TextSelection)) {
    return false;
  }
  if (!state.selection.empty) {
    return false;
  }
  return state.selection.$from.parent.isTextblock;
}

export function selectCaretBlockCommand(): Command {
  return (state, dispatch, view) => {
    if (!escapeSelectsCaretBlock(state, view)) {
      return false;
    }
    const index = state.selection.$from.index(0);
    const tr = selectBlockByIndex(state, index, false);
    if (tr === null || dispatch === undefined) {
      return tr !== null;
    }
    dispatch(tr);
    return true;
  };
}

function blockIsSelected(state: BlockHandleState, index: number): boolean {
  if (state.from === null || state.to === null) {
    return false;
  }
  const from = Math.min(state.from, state.to);
  const to = Math.max(state.from, state.to);
  return index >= from && index <= to;
}

export function blockHandleKindForNode(node: ProseNode): string {
  if (node.type.name === 'heading') {
    return 'heading';
  }
  if (node.type.name === 'paragraph') {
    return 'paragraph';
  }
  return node.type.name;
}

function applyHandleBlockAttrs(gutter: HTMLElement, node: ProseNode, view: EditorView): void {
  const kind = blockHandleKindForNode(node);
  gutter.setAttribute('data-block-kind', kind);
  if (typeof node.attrs.blockId === 'string' && node.attrs.blockId.length > 0) {
    gutter.setAttribute('data-block-id', node.attrs.blockId);
  }
  if (node.type.name === 'paragraph') {
    const sheetDefault = view.dom.getAttribute('data-default-line-spacing');
    const spacing = effectiveLineSpacing(node.attrs.lineSpacing, {
      defaultLineSpacing: isLineSpacing(sheetDefault) ? sheetDefault : undefined,
    });
    gutter.setAttribute('data-line-spacing', spacing);
    gutter.setAttribute('data-space-before', String(node.attrs.spaceBefore ?? 0));
  }
  if (node.type.name === 'heading') {
    gutter.setAttribute('data-heading-level', String(node.attrs.level ?? 1));
  }
}

function blockSelectionIsActive(state: EditorState): boolean {
  if (blockHandleState(state).from !== null) {
    return true;
  }
  return state.selection instanceof NodeSelection && state.selection.$anchor.depth === 0;
}

function selectionFromEditorGeometry(
  tr: Transaction,
  view: EditorView,
  event: MouseEvent,
  doc: ProseNode,
): Transaction {
  const rect = view.dom.getBoundingClientRect();
  if (rect.height <= 0) {
    return tr.setSelection(
      event.clientY <= rect.top ? TextSelection.atStart(doc) : TextSelection.atEnd(doc),
    );
  }
  if (event.clientY <= rect.top + rect.height / 2) {
    return tr.setSelection(TextSelection.atStart(doc));
  }
  return tr.setSelection(TextSelection.atEnd(doc));
}

const BLOCK_CONTENT_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, pre, hr';

const DRAG_START_PX = 4;

function blockContentElement(view: EditorView, blockIndex: number): HTMLElement | null {
  const pos = blockPosAtIndex(view.state.doc, blockIndex) + 1;
  const dom = view.nodeDOM(pos);
  if (dom instanceof HTMLElement) {
    return dom;
  }
  let seen = 0;
  for (const child of view.dom.children) {
    if (!(child instanceof HTMLElement)) {
      continue;
    }
    if (child.classList.contains('block-handle')) {
      continue;
    }
    if (seen === blockIndex) {
      return child;
    }
    seen += 1;
  }
  return null;
}

function gapCenterY(view: EditorView, dropIndex: number): number | null {
  const { doc } = view.state;
  try {
    if (dropIndex <= 0) {
      const coords = view.coordsAtPos(Math.min(1, doc.content.size));
      return coords.top;
    }
    if (dropIndex >= doc.childCount) {
      const coords = view.coordsAtPos(doc.content.size);
      return coords.bottom;
    }
    const abovePos = blockPosAtIndex(doc, dropIndex - 1) + 1;
    const belowPos = blockPosAtIndex(doc, dropIndex) + 1;
    const above = view.coordsAtPos(abovePos);
    const below = view.coordsAtPos(belowPos);
    return (above.bottom + below.top) / 2;
  } catch {
    // Fall back to DOM measurements when coords are unavailable.
  }
  if (dropIndex <= 0) {
    const first = blockContentElement(view, 0);
    if (first === null) {
      return null;
    }
    return first.getBoundingClientRect().top;
  }
  if (dropIndex >= doc.childCount) {
    const last = blockContentElement(view, doc.childCount - 1);
    if (last === null) {
      return null;
    }
    return last.getBoundingClientRect().bottom;
  }
  const above = blockContentElement(view, dropIndex - 1);
  const below = blockContentElement(view, dropIndex);
  if (above === null || below === null) {
    return null;
  }
  const aboveRect = above.getBoundingClientRect();
  const belowRect = below.getBoundingClientRect();
  return (aboveRect.bottom + belowRect.top) / 2;
}

export function dropIndexFromClientY(view: EditorView, clientY: number): number {
  const { doc } = view.state;
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index <= doc.childCount; index += 1) {
    const center = gapCenterY(view, index);
    if (center === null) {
      continue;
    }
    const distance = Math.abs(clientY - center);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function setBlockDragState(
  view: EditorView,
  drag: BlockDragState | null,
): void {
  const current = blockHandleState(view.state);
  view.dispatch(view.state.tr.setMeta(blockHandlePluginKey, { ...current, drag }));
}

function endBlockDrag(view: EditorView, drag: BlockDragState | null): void {
  view.dom.removeAttribute('data-block-drag');
  if (drag !== null) {
    setBlockDragState(view, null);
  }
}

function startBlockDragListeners(
  view: EditorView,
  sourceFrom: number,
  sourceTo: number,
  startX: number,
  startY: number,
  onClick: (() => void) | null,
): void {
  const doc = view.dom.ownerDocument;
  let pointerX = startX;
  let pointerY = startY;
  let dragging = false;
  let dragState: BlockDragState | null = null;

  function cleanup(): void {
    doc.removeEventListener('mousemove', onMove);
    doc.removeEventListener('mouseup', onUp);
    doc.removeEventListener('keydown', onKey);
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key !== 'Escape') {
      return;
    }
    event.preventDefault();
    cleanup();
    endBlockDrag(view, dragState);
  }

  function onMove(event: MouseEvent): void {
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (!dragging) {
      const dx = pointerX - startX;
      const dy = pointerY - startY;
      if (dx * dx + dy * dy < DRAG_START_PX * DRAG_START_PX) {
        return;
      }
      dragging = true;
      view.dom.setAttribute('data-block-drag', 'true');
      dragState = { sourceFrom, sourceTo, dropIndex: null };
      dispatchHover(view, null, false);
    }
    const dropIndex = dropIndexFromClientY(view, pointerY);
    dragState = { sourceFrom, sourceTo, dropIndex };
    setBlockDragState(view, dragState);
  }

  function onUp(event: MouseEvent): void {
    cleanup();
    if (!dragging || dragState === null || dragState.dropIndex === null) {
      endBlockDrag(view, dragState);
      if (!dragging) {
        onClick?.();
      }
      return;
    }
    const command = moveBlockRangeToDropCommand(
      dragState.sourceFrom,
      dragState.sourceTo,
      dragState.dropIndex,
    );
    endBlockDrag(view, dragState);
    command(view.state, view.dispatch.bind(view));
    event.preventDefault();
  }

  doc.addEventListener('mousemove', onMove);
  doc.addEventListener('mouseup', onUp);
  doc.addEventListener('keydown', onKey);
}

function pointerTargetsBlockContent(view: EditorView, event: MouseEvent): boolean {
  if (!(event.target instanceof HTMLElement)) {
    return false;
  }
  if (!view.dom.contains(event.target)) {
    return false;
  }
  return event.target.closest(BLOCK_CONTENT_SELECTOR) !== null;
}

function textSelectionForBlockSelectionClear(
  view: EditorView,
  event: MouseEvent,
  base: Transaction,
): Transaction {
  if (pointerTargetsBlockContent(view, event)) {
    return textSelectionForEditorPointer(view, event, base);
  }
  return selectionFromEditorGeometry(base, view, event, base.doc);
}

function textSelectionAtResolved(tr: Transaction, doc: ProseNode, pos: number): Transaction {
  try {
    const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
    return tr.setSelection(TextSelection.near($pos, 1));
  } catch {
    return tr;
  }
}

function markPointerSelection(tr: Transaction): Transaction {
  return tr.setMeta('pointer', true).setMeta('uiEvent', 'contextmenu');
}

export function textSelectionForEditorPointer(
  view: EditorView,
  event: MouseEvent,
  base?: Transaction,
): Transaction {
  const tr = base ?? view.state.tr;
  const { doc } = tr;
  const hit = (() => {
    try {
      return view.posAtCoords({ left: event.clientX, top: event.clientY });
    } catch {
      return null;
    }
  })();
  if (hit) {
    try {
      return markPointerSelection(tr.setSelection(TextSelection.create(doc, hit.pos)));
    } catch {
      return markPointerSelection(textSelectionAtResolved(tr, doc, hit.pos));
    }
  }
  return markPointerSelection(selectionFromEditorGeometry(tr, view, event, doc));
}

export function textSelectionFromDocumentCoords(doc: ProseNode, anchor: number, head: number): Selection {
  try {
    return TextSelection.create(doc, anchor, head);
  } catch {
    const pos = Math.max(0, Math.min(head, doc.content.size));
    const near = TextSelection.near(doc.resolve(pos), -1);
    if (near instanceof TextSelection) {
      return near;
    }
    return TextSelection.atEnd(doc);
  }
}

export function clearBlockSelectionForPointerClick(view: EditorView, event: MouseEvent): boolean {
  if (!(event.target instanceof HTMLElement)) {
    return false;
  }
  if (event.target.closest('.block-handle') !== null) {
    return false;
  }
  if (!blockSelectionIsActive(view.state)) {
    return false;
  }
  let tr = setBlockHandleState(view.state.tr, emptyBlockHandleState());
  tr = textSelectionForBlockSelectionClear(view, event, tr);
  view.dispatch(tr);
  return true;
}

function blockHandleMouseDown(
  view: EditorView,
  event: MouseEvent,
  blockIndex: number,
  onClick: (() => void) | null,
): void {
  event.preventDefault();
  event.stopPropagation();
  dispatchHover(view, blockIndex, true);
  const tr = selectBlockByIndex(view.state, blockIndex, event.shiftKey);
  if (tr === null) {
    return;
  }
  view.dispatch(tr.setMeta('pointer', true));
  view.focus();
  const range = selectedBlockRange(view.state);
  const from = range?.from ?? blockIndex;
  const to = range?.to ?? blockIndex;
  startBlockDragListeners(view, from, to, event.clientX, event.clientY, onClick);
}

export function activeBlockHandleIndex(state: EditorState): number | null {
  const pluginState = blockHandleState(state);
  if (pluginState.drag !== null) {
    return null;
  }
  return pluginState.hoverBlock;
}

function blockDecorations(state: EditorState): DecorationSet {
  const pluginState = blockHandleState(state);
  const decorations: Decoration[] = [];
  const hint = emptyBlockHintDecoration(state);
  if (hint !== null) {
    decorations.push(hint);
  }
  let pos = 0;
  for (let index = 0; index < state.doc.childCount; index += 1) {
    const node = state.doc.child(index);
    const blockStart = pos;
    if (pluginState.hoverBlock === index) {
      decorations.push(
        Decoration.node(blockStart, blockStart + node.nodeSize, {
          class: 'block-is-hovered',
          'data-block-hovered': 'true',
        }),
      );
    }
    if (blockIsSelected(pluginState, index)) {
      decorations.push(
        Decoration.node(blockStart, blockStart + node.nodeSize, {
          class: 'block-is-selected',
          'data-block-selected': 'true',
        }),
      );
    }
    pos += node.nodeSize;
  }
  const drag = pluginState.drag;
  if (drag !== null && drag.dropIndex !== null) {
    const dropIndex = drag.dropIndex;
    const dropPos = dropIndex >= state.doc.childCount
      ? state.doc.content.size
      : blockPosAtIndex(state.doc, dropIndex);
    decorations.push(
      Decoration.widget(dropPos, () => {
        const indicator = document.createElement('div');
        indicator.className = 'block-drop-indicator';
        indicator.setAttribute('data-drop-index', String(dropIndex));
        return indicator;
      }, {
        key: `block-drop-${dropIndex}`,
        side: dropIndex >= state.doc.childCount ? 1 : -1,
      }),
    );
  }
  return DecorationSet.create(state.doc, decorations);
}

interface BlockHandleOverlay {
  sync(view: EditorView): void;
  destroy(): void;
}

function blockHandleLayerHost(view: EditorView): HTMLElement {
  const region = view.dom.closest('.page-region');
  if (region instanceof HTMLElement) {
    return region;
  }
  return view.dom.parentElement ?? view.dom;
}

export function blockHandleLayoutForBlock(
  view: EditorView,
  blockIndex: number,
  layerEl?: HTMLElement,
): { top: number; left: number; height: number } | null {
  const blockEl = blockContentElement(view, blockIndex);
  if (blockEl === null) {
    return null;
  }
  const layer = layerEl ?? view.dom.ownerDocument.querySelector('.block-handle-layer');
  if (!(layer instanceof HTMLElement)) {
    return null;
  }
  const blockRect = blockEl.getBoundingClientRect();
  const layerRect = layer.getBoundingClientRect();
  if (blockRect.height <= 0) {
    return null;
  }
  const rootStyle = getComputedStyle(view.dom.ownerDocument.documentElement);
  const gutterWidth = (parseFloat(rootStyle.getPropertyValue('--size-block-gutter')) || 52) * pageZoomFactor(layer);
  return {
    top: blockRect.top - layerRect.top,
    left: blockRect.left - layerRect.left - gutterWidth,
    height: blockRect.height,
  };
}

function pageZoomFactor(element: HTMLElement): number {
  const view = element.ownerDocument.defaultView;
  if (view === null || typeof view.getComputedStyle !== 'function') {
    return 1;
  }
  try {
    const raw = view.getComputedStyle(element).getPropertyValue('--page-zoom');
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value) || value <= 0) {
      return 1;
    }
    return value;
  } catch {
    return 1;
  }
}

function applyBlockHandleLayout(
  gutter: HTMLElement,
  layout: { top: number; left: number; height: number },
): void {
  gutter.style.setProperty('--block-handle-top', `${layout.top}px`);
  gutter.style.setProperty('--block-handle-left', `${layout.left}px`);
  gutter.style.setProperty('--block-handle-height', `${layout.height}px`);
}

function scrollableAncestors(element: HTMLElement): HTMLElement[] {
  const seen = new Set<HTMLElement>();
  const stack: HTMLElement[] = [element];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) {
      continue;
    }
    const style = node.ownerDocument.defaultView?.getComputedStyle(node);
    if (style !== undefined) {
      const overflow = `${style.overflow} ${style.overflowX} ${style.overflowY}`;
      if (/auto|scroll|overlay/.test(overflow)) {
        seen.add(node);
      }
    }
    if (node.parentElement !== null) {
      stack.push(node.parentElement);
    }
  }
  return [...seen];
}

function eventElement(target: EventTarget | null): Element | null {
  if (!(target instanceof Node)) {
    return null;
  }
  if (target.nodeType === Node.ELEMENT_NODE) {
    return target as Element;
  }
  return target.parentElement;
}

function mountBlockHandleOverlay(view: EditorView): BlockHandleOverlay {
  const doc = view.dom.ownerDocument;
  const layer = doc.createElement('div');
  layer.className = 'block-handle-layer';
  layer.setAttribute('data-region', 'block-handle-layer');
  const gutter = doc.createElement('div');
  gutter.className = 'block-handle';
  gutter.dataset.input = 'pointer';
  gutter.hidden = true;
  const add = createGutterButton(doc, 'add');
  const grip = createGutterButton(doc, 'grip');
  const tooltip = createGripTooltip(doc);
  grip.setAttribute('aria-describedby', tooltip.id);
  grip.append(tooltip);
  gutter.append(add, grip);
  const menu = createBlockMenu(doc);
  const host = blockHandleLayerHost(view);
  host.append(layer);
  layer.append(gutter);

  let layoutFrame: number | null = null;
  let destroyed = false;
  let menuOpen = false;
  let focusedAction: string | null = null;
  let tooltipTimer: number | null = null;

  const clearGutterLayout = (): void => {
    gutter.hidden = true;
    gutter.removeAttribute('data-block-index');
    gutter.removeAttribute('data-hover-active');
    gutter.style.removeProperty('--block-handle-top');
    gutter.style.removeProperty('--block-handle-left');
    gutter.style.removeProperty('--block-handle-height');
  };

  const relayout = (): void => {
    if (destroyed || gutter.hidden) {
      return;
    }
    const blockIndex = Number(gutter.getAttribute('data-block-index'));
    if (!Number.isInteger(blockIndex)) {
      return;
    }
    const layout = blockHandleLayoutForBlock(view, blockIndex, layer);
    if (layout === null || layout.height <= 0) {
      clearGutterLayout();
      return;
    }
    gutter.hidden = false;
    applyBlockHandleLayout(gutter, layout);
  };
  const scheduleLayout = (): void => {
    if (destroyed) {
      return;
    }
    const frameWindow = view.dom.ownerDocument.defaultView;
    const useFrame = frameWindow !== null && typeof frameWindow.requestAnimationFrame === 'function';
    if (!useFrame) {
      queueMicrotask(relayout);
      return;
    }
    if (layoutFrame !== null) {
      frameWindow.cancelAnimationFrame(layoutFrame);
    }
    layoutFrame = frameWindow.requestAnimationFrame(() => {
      layoutFrame = null;
      relayout();
    });
  };

  const scrollTargets = new Set<HTMLElement>([
    ...scrollableAncestors(view.dom),
    ...scrollableAncestors(host),
  ]);
  const onScrollOrResize = (): void => {
    scheduleLayout();
  };
  const win = view.dom.ownerDocument.defaultView;
  for (const target of scrollTargets) {
    target.addEventListener('scroll', onScrollOrResize, { passive: true });
  }
  win?.addEventListener('resize', onScrollOrResize, { passive: true });

  const hideTooltip = (): void => {
    if (tooltipTimer !== null) {
      win?.clearTimeout(tooltipTimer);
      tooltipTimer = null;
    }
    tooltip.dataset.open = 'false';
  };
  const showTooltip = (immediate: boolean): void => {
    hideTooltip();
    const reveal = (): void => {
      tooltipTimer = null;
      tooltip.dataset.open = 'true';
    };
    if (immediate || win === null) {
      reveal();
      return;
    }
    tooltipTimer = win.setTimeout(reveal, GRIP_TOOLTIP_HOVER_MS);
  };

  const markGutterMenu = (open: boolean): void => {
    if (open) {
      gutter.setAttribute('data-menu-open', 'true');
      gutter.setAttribute('data-menu-control', 'grip');
      grip.setAttribute('aria-expanded', 'true');
    } else {
      gutter.removeAttribute('data-menu-open');
      gutter.removeAttribute('data-menu-control');
      grip.removeAttribute('aria-expanded');
    }
  };

  const closeMenu = (restoreFocus: boolean, unlock = true, caretToText = false): void => {
    const wasOpen = menuOpen;
    const blockIndex = Number(menu.root.dataset.blockIndex);
    menuOpen = false;
    menu.root.hidden = true;
    menu.root.remove();
    menu.search.value = '';
    focusedAction = null;
    menu.search.removeAttribute('aria-activedescendant');
    markGutterMenu(false);
    if (wasOpen && unlock) {
      lockBlockMenuGutter(view, null);
    }
    if (!restoreFocus || view.isDestroyed) {
      return;
    }
    const page = view.dom.closest('.page-sheet');
    if (page instanceof HTMLElement) {
      resetPageFocusToPointer(page);
    }
    // Esc puts the caret back in the block's text, not on the whole block.
    if (caretToText && Number.isInteger(blockIndex) && blockIndex >= 0 && blockIndex < view.state.doc.childCount) {
      const { selection } = view.state;
      const caretInBlock = selection instanceof TextSelection
        && selection.empty
        && selection.$from.index(0) === blockIndex;
      if (!caretInBlock) {
        const pos = blockPosAtIndex(view.state.doc, blockIndex);
        const node = view.state.doc.child(blockIndex);
        const caret = Selection.near(view.state.doc.resolve(Math.min(pos + 1, pos + node.nodeSize - 1)));
        let tr = view.state.tr.setSelection(caret);
        tr = setBlockHandleState(tr, { ...blockHandleState(view.state), anchor: null, from: null, to: null });
        view.dispatch(tr);
      }
    }
    view.focus();
  };

  const paintMenu = (blockIndex: number): void => {
    const mode = menu.root.dataset.input === 'keyboard' ? 'keyboard' : 'pointer';
    focusedAction = paintBlockMenu(
      menu,
      view.state,
      blockIndex,
      menu.search.value,
      mode,
      focusedAction,
    );
  };

  const openMenu = (blockIndex: number): void => {
    if (blockIndex < 0 || blockIndex >= view.state.doc.childCount) {
      return;
    }
    menuOpen = true;
    focusedAction = null;
    menu.search.value = '';
    menu.root.dataset.input = 'pointer';
    paintBlockMenu(menu, view.state, blockIndex, '', 'pointer', null);
    if (!menu.root.isConnected) {
      layer.append(menu.root);
    }
    menu.root.hidden = false;
    const gripRect = grip.getBoundingClientRect();
    const menuRect = menu.root.getBoundingClientRect();
    const gap = 8;
    const width = menuRect.width > 0 ? menuRect.width : 280;
    const height = menuRect.height > 0 ? menuRect.height : 240;
    const viewWidth = win?.innerWidth ?? gripRect.right + width;
    const viewHeight = win?.innerHeight ?? gripRect.bottom + height;
    let left = gripRect.right + gap;
    let top = gripRect.top;
    if (left + width > viewWidth) {
      left = Math.max(gap, gripRect.left - width - gap);
    }
    if (top + height > viewHeight) {
      top = Math.max(gap, viewHeight - height - gap);
    }
    menu.root.style.setProperty('--block-menu-left', `${left}px`);
    menu.root.style.setProperty('--block-menu-top', `${top}px`);
    markGutterMenu(true);
    lockBlockMenuGutter(view, blockIndex);
    menu.search.focus();
  };

  const runAction = (actionId: string): void => {
    const blockIndex = Number(menu.root.dataset.blockIndex);
    if (!Number.isInteger(blockIndex)) {
      closeMenu(true);
      return;
    }
    const select = selectBlockByIndex(view.state, blockIndex, false);
    if (select !== null) {
      view.dispatch(select);
    }
    applyBlockMenuAction(view.state, blockIndex, actionId, (tr) => {
      view.dispatch(tr);
    }, view);
    closeMenu(true);
  };

  gutter.addEventListener('mouseenter', () => {
    if (blockMenuLocks.has(view)) {
      return;
    }
    const index = activeBlockHandleIndex(view.state);
    if (index !== null) {
      dispatchHover(view, index, true);
    }
  });
  gutter.addEventListener('mouseleave', (event) => {
    if (menuOpen || blockMenuLocks.has(view)) {
      return;
    }
    const index = activeBlockHandleIndex(view.state);
    const blockEl = index === null ? null : blockContentElement(view, index);
    const related = event.relatedTarget;
    if (related instanceof Node && blockEl !== null) {
      if (blockEl === related || blockEl.contains(related)) {
        return;
      }
    }
    if (related instanceof Node && (gutter.contains(related) || menu.root.contains(related))) {
      return;
    }
    if (blockHandleState(view.state).drag === null) {
      dispatchHover(view, null, false);
    }
  });
  add.addEventListener('mousedown', (event) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    gutter.dataset.input = 'pointer';
    const blockIndex = Number(gutter.getAttribute('data-block-index'));
    if (!Number.isInteger(blockIndex)) {
      return;
    }
    closeMenu(false);
    const tr = insertEmptyBlockWithSlashMenu(view.state, blockIndex, 'below');
    if (tr === null) {
      return;
    }
    view.dispatch(tr);
    view.focus();
    // The insert resets hover, so without a lock the controls vanish as the menu opens.
    // Keep them on the new block, with + pressed, until that slash menu closes.
    if (slashMenuOpenWithoutSlash(view.state)) {
      lockBlockMenuGutter(view, blockIndex + 1, 'slash', 'add');
    }
  });
  gutter.addEventListener('mousedown', (event) => {
    if (event.button !== 0) {
      return;
    }
    const target = eventElement(event.target);
    if (target === null) {
      return;
    }
    if (target.closest('.block-gutter-add') !== null) {
      return;
    }
    gutter.dataset.input = 'pointer';
    const blockIndex = Number(gutter.getAttribute('data-block-index'));
    if (!Number.isInteger(blockIndex)) {
      return;
    }
    const onGrip = target.closest('.block-gutter-grip') !== null;
    // A second click on the grip of the open menu closes it, like a menu button.
    const toggleClose = onGrip && menuOpen && Number(menu.root.dataset.blockIndex) === blockIndex;
    if (menuOpen) {
      closeMenu(false);
    }
    const openOnClick = !event.shiftKey && onGrip && !toggleClose;
    blockHandleMouseDown(
      view,
      event,
      blockIndex,
      openOnClick ? () => openMenu(blockIndex) : null,
    );
  });
  for (const control of [add, grip]) {
    control.addEventListener('focus', () => {
      gutter.dataset.input = 'keyboard';
    });
    control.addEventListener('pointerdown', () => {
      gutter.dataset.input = 'pointer';
    });
  }
  grip.addEventListener('mouseenter', () => {
    showTooltip(false);
  });
  grip.addEventListener('mouseleave', hideTooltip);
  grip.addEventListener('focus', () => {
    showTooltip(true);
  });
  grip.addEventListener('blur', hideTooltip);

  menu.search.addEventListener('input', () => {
    const blockIndex = Number(menu.root.dataset.blockIndex);
    if (!Number.isInteger(blockIndex) || blockIndex < 0 || blockIndex >= view.state.doc.childCount) {
      return;
    }
    focusedAction = null;
    paintMenu(blockIndex);
  });
  menu.search.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      menu.root.dataset.input = 'keyboard';
      const ids = blockMenuOptionIds(menu.list);
      if (ids.length === 0) {
        return;
      }
      const current = focusedAction === null ? -1 : ids.indexOf(focusedAction);
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const next = current === -1
        ? (delta > 0 ? 0 : ids.length - 1)
        : (current + delta + ids.length) % ids.length;
      focusedAction = ids[next] ?? null;
      const blockIndex = Number(menu.root.dataset.blockIndex);
      if (Number.isInteger(blockIndex)) {
        paintMenu(blockIndex);
      }
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const ids = blockMenuOptionIds(menu.list);
      const chosen = focusedAction !== null && ids.includes(focusedAction) ? focusedAction : ids[0];
      if (chosen !== undefined) {
        runAction(chosen);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true, true, true);
    }
  });
  menu.list.addEventListener('mousedown', (event) => {
    event.preventDefault();
  });
  menu.list.addEventListener('click', (event) => {
    const target = eventElement(event.target);
    if (target === null) {
      return;
    }
    const row = target.closest('.block-menu-action');
    if (!(row instanceof HTMLElement)) {
      return;
    }
    if (row.getAttribute('aria-disabled') === 'true') {
      return;
    }
    const actionId = row.dataset.action;
    if (actionId === undefined) {
      return;
    }
    runAction(actionId);
  });
  menu.list.addEventListener('mousemove', (event) => {
    const target = eventElement(event.target);
    if (target === null || target.closest('.block-menu-action') === null) {
      return;
    }
    if (menu.root.dataset.input === 'pointer' && focusedAction === null) {
      return;
    }
    menu.root.dataset.input = 'pointer';
    focusedAction = null;
    const blockIndex = Number(menu.root.dataset.blockIndex);
    if (Number.isInteger(blockIndex) && blockIndex >= 0 && blockIndex < view.state.doc.childCount) {
      paintMenu(blockIndex);
    }
  });
  // Same rule as the context menu and the slash menu: any press or right-click
  // outside the menu closes it, and so does the window losing focus.
  // A left press on this gutter's own buttons is left to their handlers.
  const stopOutsidePress = watchOutsidePress(win ?? doc, {
    isOpen: () => menuOpen,
    isInside(target, event) {
      if (target !== null && menu.root.contains(target)) {
        return true;
      }
      const button = event instanceof MouseEvent ? event.button : 0;
      return event.type !== 'contextmenu' && button === 0 && target instanceof Element
        && target.closest('.block-gutter-button') !== null && gutter.contains(target);
    },
    onOutside() {
      closeMenu(false);
    },
  });

  const sync = (editorView: EditorView): void => {
    if (destroyed) {
      return;
    }
    const pluginState = blockHandleState(editorView.state);
    const dragActive = pluginState.drag !== null || editorView.dom.hasAttribute('data-block-drag');
    if (dragActive) {
      if (menuOpen) {
        closeMenu(false, false);
        clearBlockMenuLock(editorView);
      }
      layer.hidden = true;
      layer.setAttribute('data-block-drag', 'true');
      clearGutterLayout();
      return;
    }
    layer.hidden = false;
    layer.removeAttribute('data-block-drag');
    let locked = blockMenuLockIndex(editorView);
    if (locked !== null && locked >= editorView.state.doc.childCount) {
      clearBlockMenuLock(editorView);
      locked = null;
    }
    const index = locked ?? activeBlockHandleIndex(editorView.state);
    if (index === null || index < 0 || index >= editorView.state.doc.childCount) {
      if (menuOpen) {
        closeMenu(false, false);
        clearBlockMenuLock(editorView);
      }
      gutter.removeAttribute('data-menu-open');
      gutter.removeAttribute('data-menu-control');
      clearGutterLayout();
      return;
    }
    const control = locked === null ? null : blockMenuLockInfo.get(editorView)?.control ?? null;
    if (locked === null && !menuOpen) {
      gutter.removeAttribute('data-menu-open');
      gutter.removeAttribute('data-menu-control');
    } else if (locked !== null && control !== null) {
      gutter.setAttribute('data-menu-open', 'true');
      gutter.setAttribute('data-menu-control', control);
    } else if (locked !== null) {
      // A text right-click menu keeps the controls showing without the pressed look.
      gutter.removeAttribute('data-menu-open');
      gutter.removeAttribute('data-menu-control');
    }
    const node = editorView.state.doc.child(index);
    gutter.hidden = false;
    gutter.setAttribute('data-block-index', String(index));
    gutter.setAttribute('data-hover-active', 'true');
    applyHandleBlockAttrs(gutter, node, editorView);
    if (menuOpen) {
      const menuIndex = Number(menu.root.dataset.blockIndex);
      if (menuIndex === index) {
        paintMenu(index);
      }
    }
    scheduleLayout();
  };

  blockMenuSyncs.set(view, sync);

  return {
    sync,
    destroy(): void {
      destroyed = true;
      hideTooltip();
      blockMenuSyncs.delete(view);
      clearBlockMenuLock(view);
      stopOutsidePress();
      if (layoutFrame !== null) {
        win?.cancelAnimationFrame(layoutFrame);
      }
      for (const target of scrollTargets) {
        target.removeEventListener('scroll', onScrollOrResize);
      }
      win?.removeEventListener('resize', onScrollOrResize);
      layer.remove();
    },
  };
}

export function blockHandleKeymap(): Record<string, Command> {
  return {
    Escape: selectCaretBlockCommand(),
    ...blockMoveKeymap(),
  };
}

export function blockHandlePlugin(): Plugin {
  let overlay: BlockHandleOverlay | null = null;
  return new Plugin({
    key: blockHandlePluginKey,
    state: {
      init() {
        return emptyBlockHandleState();
      },
      apply(tr, value) {
        const meta = tr.getMeta(blockHandlePluginKey);
        if (meta !== undefined) {
          return meta as BlockHandleState;
        }
        if (tr.docChanged) {
          const drag = value.drag;
          return {
            ...emptyBlockHandleState(),
            drag,
          };
        }
        if (tr.selectionSet && !tr.getMeta('blockHandleKeep')) {
          return {
            ...value,
            anchor: null,
            from: null,
            to: null,
            drag: null,
          };
        }
        return value;
      },
    },
    props: {
      decorations(state) {
        return blockDecorations(state);
      },
      handleDOMEvents: {
        mousemove(view, event) {
          if (blockMenuLockOwner(view) === 'context'
            && view.dom.ownerDocument.querySelector('[data-region="context-menu"]') === null) {
            // The context menu closed without telling the editor. Let hover follow the pointer again.
            lockBlockMenuGutter(view, null, 'context');
          }
          if (!(event.target instanceof HTMLElement) || blockMenuLocks.has(view)) {
            return false;
          }
          if (event.target.closest('.block-handle') !== null) {
            return false;
          }
          const index = hoverBlockIndexFromPointer(view, event);
          const handleState = blockHandleState(view.state);
          if (index !== null) {
            dispatchHover(view, index, false);
          } else if (!handleState.hoverPinned && handleState.drag === null) {
            dispatchHover(view, null, false);
          }
          return false;
        },
        mouseleave(view, event) {
          const current = blockHandleState(view.state);
          if (current.drag !== null || current.hoverPinned || blockMenuLocks.has(view)) {
            return false;
          }
          const related = event.relatedTarget;
          if (related instanceof Node) {
            if (view.dom.contains(related)) {
              return false;
            }
            if (related instanceof HTMLElement && related.closest('.block-handle-layer') !== null) {
              return false;
            }
          }
          dispatchHover(view, null, false);
          return false;
        },
        mousedown(view, event) {
          if (!(event.target instanceof HTMLElement)) {
            return false;
          }
          if (event.target.closest('.block-handle') !== null) {
            return true;
          }
          if (blockSelectionIsActive(view.state)) {
            clearBlockSelectionForPointerClick(view, event);
          }
          return false;
        },
        keydown(view, event) {
          if (blockHandleState(view.state).drag !== null || blockMenuLocks.has(view)) {
            return false;
          }
          if (!(event.target instanceof HTMLElement)) {
            return false;
          }
          if (event.target.closest('.block-handle') !== null) {
            return false;
          }
          dispatchHover(view, null, false);
          return false;
        },
      },
    },
    view(editorView) {
      overlay = mountBlockHandleOverlay(editorView);
      overlay.sync(editorView);
      return {
        update(view) {
          overlay?.sync(view);
        },
        destroy() {
          overlay?.destroy();
          overlay = null;
        },
      };
    },
  });
}
