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
}

export const blockHandlePluginKey = new PluginKey<BlockHandleState>('blockHandle');

export function emptyBlockHandleState(): BlockHandleState {
  return { anchor: null, from: null, to: null, drag: null };
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

function selectBlocks(
  tr: Transaction,
  from: number,
  to: number,
  anchor: number,
): Transaction {
  const doc = tr.doc;
  const start = Math.max(0, Math.min(from, to));
  const end = Math.min(doc.childCount - 1, Math.max(from, to));
  const nodePos = blockPosAtIndex(doc, start);
  return setBlockHandleState(
    tr.setSelection(NodeSelection.create(doc, nodePos)).setMeta('blockHandleKeep', true),
    { anchor, from: start, to: end, drag: null },
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
    return selectBlocks(state.tr, current.anchor, blockIndex, current.anchor);
  }
  return selectBlocks(state.tr, blockIndex, blockIndex, blockIndex);
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

function applyHandleBlockAttrs(button: HTMLButtonElement, node: ProseNode): void {
  button.setAttribute('data-block-kind', node.type.name);
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

function blockDecorations(state: EditorState): DecorationSet {
  const pluginState = blockHandleState(state);
  const caretBlock = caretBlockIndex(state);
  const decorations: Decoration[] = [];
  let pos = 0;
  for (let index = 0; index < state.doc.childCount; index += 1) {
    const node = state.doc.child(index);
    const blockStart = pos;
    decorations.push(
      Decoration.widget(blockStart, (view, getPos) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'block-handle';
        button.tabIndex = -1;
        button.setAttribute('data-block-index', String(index));
        button.setAttribute('aria-label', 'Select block');
        applyHandleBlockAttrs(button, node);
        if (index === caretBlock) {
          button.setAttribute('data-caret-block', 'true');
        }
        button.addEventListener('mousedown', (event) => {
          const widgetPos = getPos();
          if (widgetPos === undefined) {
            return;
          }
          const blockIndex = blockIndexAtPos(view.state.doc, widgetPos);
          blockHandleMouseDown(view, event, blockIndex);
        });
        return button;
      }, { side: -1, key: `block-handle-${index}-caret-${caretBlock}` }),
    );
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

export function blockHandleKeymap(): Record<string, Command> {
  return {
    Escape: selectCaretBlockCommand(),
    ...blockMoveKeymap(),
  };
}

export function blockHandlePlugin(): Plugin {
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
          return emptyBlockHandleState();
        }
        if (tr.selectionSet && !tr.getMeta('blockHandleKeep')) {
          return emptyBlockHandleState();
        }
        return value;
      },
    },
    props: {
      decorations(state) {
        return blockDecorations(state);
      },
      handleDOMEvents: {
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
      },
    },
  });
}
