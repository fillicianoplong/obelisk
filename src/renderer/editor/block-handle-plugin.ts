import { Decoration, DecorationSet } from 'prosemirror-view';
import type { EditorView } from 'prosemirror-view';
import type { Node as ProseNode } from 'prosemirror-model';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import { Plugin, PluginKey } from 'prosemirror-state';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import { blockMoveKeymap, moveBlockRangeToDropCommand } from './block-move-commands.js';

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
  try {
    const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
    if (hit === null) {
      return null;
    }
    return blockIndexAtPos(view.state.doc, hit.pos);
  } catch {
    return null;
  }
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

function applyHandleBlockAttrs(button: HTMLButtonElement, node: ProseNode): void {
  const kind = blockHandleKindForNode(node);
  button.setAttribute('data-block-kind', kind);
  if (typeof node.attrs.blockId === 'string' && node.attrs.blockId.length > 0) {
    button.setAttribute('data-block-id', node.attrs.blockId);
  }
  if (node.type.name === 'paragraph') {
    button.setAttribute('data-line-spacing', String(node.attrs.lineSpacing ?? 'single'));
    button.setAttribute('data-space-before', String(node.attrs.spaceBefore ?? 0));
  }
  if (node.type.name === 'heading') {
    button.setAttribute('data-heading-level', String(node.attrs.level ?? 1));
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
    return tr.setSelection(TextSelection.create(doc, hit.pos));
  }
  return selectionFromEditorGeometry(tr, view, event, doc);
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

function blockHandleMouseDown(view: EditorView, event: MouseEvent, blockIndex: number): void {
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
  startBlockDragListeners(view, from, to, event.clientX, event.clientY);
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
  const hitWidth = parseFloat(rootStyle.getPropertyValue('--size-block-handle-hit')) || 12;
  return {
    top: blockRect.top - layerRect.top,
    left: blockRect.left - layerRect.left - hitWidth,
    height: blockRect.height,
  };
}

function applyBlockHandleLayout(
  button: HTMLButtonElement,
  layout: { top: number; left: number; height: number },
): void {
  button.style.setProperty('--block-handle-top', `${layout.top}px`);
  button.style.setProperty('--block-handle-left', `${layout.left}px`);
  button.style.setProperty('--block-handle-height', `${layout.height}px`);
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

function mountBlockHandleOverlay(view: EditorView): BlockHandleOverlay {
  const layer = document.createElement('div');
  layer.className = 'block-handle-layer';
  layer.setAttribute('data-region', 'block-handle-layer');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'block-handle';
  button.tabIndex = -1;
  button.setAttribute('aria-label', 'Select block');
  button.hidden = true;
  const host = blockHandleLayerHost(view);
  host.append(layer);
  layer.append(button);

  let layoutFrame: number | null = null;
  let destroyed = false;
  const relayout = (): void => {
    if (destroyed || button.hidden) {
      return;
    }
    const blockIndex = Number(button.getAttribute('data-block-index'));
    if (!Number.isInteger(blockIndex)) {
      return;
    }
    const layout = blockHandleLayoutForBlock(view, blockIndex, layer);
    if (layout === null || layout.height <= 0) {
      button.hidden = true;
      button.style.removeProperty('--block-handle-top');
      button.style.removeProperty('--block-handle-left');
      button.style.removeProperty('--block-handle-height');
      return;
    }
    button.hidden = false;
    applyBlockHandleLayout(button, layout);
  };
  const scheduleLayout = (): void => {
    if (destroyed) {
      return;
    }
    const win = view.dom.ownerDocument.defaultView;
    const useFrame = win !== null && typeof win.requestAnimationFrame === 'function';
    if (!useFrame) {
      queueMicrotask(relayout);
      return;
    }
    if (layoutFrame !== null) {
      win.cancelAnimationFrame(layoutFrame);
    }
    layoutFrame = win.requestAnimationFrame(() => {
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

  button.addEventListener('mouseenter', () => {
    const index = activeBlockHandleIndex(view.state);
    if (index !== null) {
      dispatchHover(view, index, true);
    }
  });
  button.addEventListener('mouseleave', (event) => {
    const index = activeBlockHandleIndex(view.state);
    const blockEl = index === null ? null : blockContentElement(view, index);
    if (event.relatedTarget instanceof Node && blockEl !== null) {
      if (blockEl === event.relatedTarget || blockEl.contains(event.relatedTarget)) {
        return;
      }
    }
    if (blockHandleState(view.state).drag === null) {
      dispatchHover(view, null, false);
    }
  });
  button.addEventListener('mousedown', (event) => {
    const blockIndex = Number(button.getAttribute('data-block-index'));
    if (!Number.isInteger(blockIndex)) {
      return;
    }
    blockHandleMouseDown(view, event, blockIndex);
  });

  const sync = (editorView: EditorView): void => {
    const pluginState = blockHandleState(editorView.state);
    const dragActive = pluginState.drag !== null || editorView.dom.hasAttribute('data-block-drag');
    if (dragActive) {
      layer.hidden = true;
      layer.setAttribute('data-block-drag', 'true');
      button.hidden = true;
      button.removeAttribute('data-block-index');
      button.removeAttribute('data-hover-active');
      button.style.removeProperty('--block-handle-top');
      button.style.removeProperty('--block-handle-left');
      button.style.removeProperty('--block-handle-height');
      return;
    }
    layer.hidden = false;
    layer.removeAttribute('data-block-drag');
    const index = activeBlockHandleIndex(editorView.state);
    if (index === null || index < 0 || index >= editorView.state.doc.childCount) {
      button.hidden = true;
      button.removeAttribute('data-block-index');
      button.removeAttribute('data-hover-active');
      button.style.removeProperty('--block-handle-top');
      button.style.removeProperty('--block-handle-left');
      button.style.removeProperty('--block-handle-height');
      return;
    }
    const node = editorView.state.doc.child(index);
    button.hidden = false;
    button.setAttribute('data-block-index', String(index));
    button.setAttribute('data-hover-active', 'true');
    applyHandleBlockAttrs(button, node);
    scheduleLayout();
  };

  return {
    sync,
    destroy(): void {
      destroyed = true;
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
          if (!(event.target instanceof HTMLElement)) {
            return false;
          }
          if (event.target.closest('.block-handle') !== null) {
            return false;
          }
          const index = blockIndexFromPointer(view, event);
          if (index !== null) {
            dispatchHover(view, index, false);
          }
          return false;
        },
        mouseleave(view, event) {
          const current = blockHandleState(view.state);
          if (current.drag !== null || current.hoverPinned) {
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
          if (blockHandleState(view.state).drag !== null) {
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
