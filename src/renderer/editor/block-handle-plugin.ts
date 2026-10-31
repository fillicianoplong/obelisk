import { Decoration, DecorationSet } from 'prosemirror-view';
import type { EditorView } from 'prosemirror-view';
import type { Node as ProseNode } from 'prosemirror-model';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import { Plugin, PluginKey } from 'prosemirror-state';
import type { Command, EditorState, Transaction } from 'prosemirror-state';

export interface BlockHandleState {
  /** Block index for Shift+click range anchor. */
  anchor: number | null;
  from: number | null;
  to: number | null;
}

export const blockHandlePluginKey = new PluginKey<BlockHandleState>('blockHandle');

export function emptyBlockHandleState(): BlockHandleState {
  return { anchor: null, from: null, to: null };
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
    { anchor, from: start, to: end },
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
  return DecorationSet.create(state.doc, decorations);
}

export function blockHandleKeymap(): Record<string, Command> {
  return {
    Escape: selectCaretBlockCommand(),
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
