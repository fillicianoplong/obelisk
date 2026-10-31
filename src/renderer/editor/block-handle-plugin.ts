import { Decoration, DecorationSet } from 'prosemirror-view';
import type { EditorView } from 'prosemirror-view';
import type { Node as ProseNode } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';

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
  const caretPos = blockPosAtIndex(doc, start) + 1;
  return setBlockHandleState(
    tr.setSelection(TextSelection.create(doc, caretPos)).setMeta('blockHandleKeep', true),
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

export function selectCaretBlockCommand(): Command {
  return (state, dispatch) => {
    const index = caretBlockIndex(state);
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
      Decoration.widget(blockStart, (view) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'block-handle';
        button.setAttribute('data-block-index', String(index));
        button.setAttribute('aria-label', 'Select block');
        if (index === caretBlock) {
          button.setAttribute('data-caret-block', 'true');
        }
        button.addEventListener('mousedown', (event) => {
          blockHandleMouseDown(view, event, index);
        });
        return button;
      }, { side: -1, key: `block-handle-${index}` }),
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
        mousedown(_view, event) {
          if (!(event.target instanceof HTMLElement)) {
            return false;
          }
          if (event.target.closest('.block-handle') !== null) {
            return true;
          }
          return false;
        },
      },
    },
  });
}
