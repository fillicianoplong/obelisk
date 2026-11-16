import type { Command, EditorState, Transaction } from 'prosemirror-state';
import { NodeSelection } from 'prosemirror-state';
import { Node as ProseNode } from 'prosemirror-model';
import { newBlockId } from './block-id.js';
import {
  blockHandlePluginKey,
  blockPosAtIndex,
  caretBlockIndex,
  emptyBlockHandleState,
  selectedBlockRange,
} from './block-handle-plugin.js';
import type { BlockHandleState } from './block-handle-plugin.js';

export function activeBlockRange(state: EditorState): { from: number; to: number } {
  const range = selectedBlockRange(state);
  if (range !== null) {
    return range;
  }
  const index = caretBlockIndex(state);
  return { from: index, to: index };
}

function blockNodes(doc: ProseNode, from: number, to: number): ProseNode[] {
  const nodes: ProseNode[] = [];
  for (let index = from; index <= to; index += 1) {
    nodes.push(doc.child(index));
  }
  return nodes;
}

function deleteBlockRange(tr: Transaction, from: number, to: number): Transaction {
  const start = blockPosAtIndex(tr.doc, from);
  const end = blockPosAtIndex(tr.doc, to) + tr.doc.child(to).nodeSize;
  return tr.delete(start, end);
}

/** Insert blocks at document block index `insertIndex`. */
export function insertBlocksAtIndex(
  tr: Transaction,
  insertIndex: number,
  nodes: readonly ProseNode[],
): Transaction {
  const clamped = Math.max(0, Math.min(insertIndex, tr.doc.childCount));
  const pos = clamped >= tr.doc.childCount
    ? tr.doc.content.size
    : blockPosAtIndex(tr.doc, clamped);
  return tr.insert(pos, nodes);
}

/**
 * Move a contiguous block range to `dropIndex` (0..childCount).
 * Returns null when the range would not move.
 */
export function moveBlockRangeTo(
  tr: Transaction,
  from: number,
  to: number,
  dropIndex: number,
): Transaction | null {
  const { doc } = tr;
  const count = to - from + 1;
  if (dropIndex < 0 || dropIndex > doc.childCount) {
    return null;
  }
  if (dropIndex >= from && dropIndex <= to + 1) {
    return null;
  }
  const nodes = blockNodes(doc, from, to);
  let next = deleteBlockRange(tr, from, to);
  let insertIndex = dropIndex;
  if (dropIndex > to) {
    insertIndex = dropIndex - count;
  }
  next = insertBlocksAtIndex(next, insertIndex, nodes);
  return next;
}

export function moveBlocksUp(tr: Transaction, from: number, to: number): Transaction | null {
  if (from <= 0) {
    return null;
  }
  return moveBlockRangeTo(tr, from, to, from - 1);
}

export function moveBlocksDown(tr: Transaction, from: number, to: number): Transaction | null {
  if (to >= tr.doc.childCount - 1) {
    return null;
  }
  return moveBlockRangeTo(tr, from, to, to + 2);
}

export function selectionAfterMove(
  from: number,
  to: number,
  dropIndex: number,
): { from: number; to: number } {
  const count = to - from + 1;
  let insertIndex = dropIndex;
  if (dropIndex > to) {
    insertIndex = dropIndex - count;
  }
  return { from: insertIndex, to: insertIndex + count - 1 };
}

export function finishBlockRangeTransaction(
  tr: Transaction,
  from: number,
  to: number,
): Transaction {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const nodePos = blockPosAtIndex(tr.doc, start);
  const handleState: BlockHandleState = {
    ...emptyBlockHandleState(),
    anchor: start,
    from: start,
    to: end,
    drag: null,
  };
  return tr
    .setSelection(NodeSelection.create(tr.doc, nodePos))
    .setMeta('blockHandleKeep', true)
    .setMeta(blockHandlePluginKey, handleState);
}

export function duplicateBlocksInRange(
  tr: Transaction,
  from: number,
  to: number,
  mint: () => string,
): Transaction {
  const nodes: ProseNode[] = [];
  for (let index = from; index <= to; index += 1) {
    const node = tr.doc.child(index);
    const json = node.toJSON() as { type: string; attrs?: Record<string, unknown> };
    json.attrs = { ...(json.attrs ?? {}), blockId: mint() };
    nodes.push(ProseNode.fromJSON(tr.doc.type.schema, json));
  }
  let pos = 0;
  for (let index = 0; index <= to; index += 1) {
    pos += tr.doc.child(index).nodeSize;
  }
  const next = tr.insert(pos, nodes);
  const copyFrom = to + 1;
  const copyTo = to + nodes.length;
  return finishBlockRangeTransaction(next, copyFrom, copyTo);
}

function runBlockMove(
  state: EditorState,
  direction: 'up' | 'down',
  dispatch: ((tr: Transaction) => void) | undefined,
): boolean {
  const { from, to } = activeBlockRange(state);
  const moved = direction === 'up'
    ? moveBlocksUp(state.tr, from, to)
    : moveBlocksDown(state.tr, from, to);
  if (moved === null) {
    return false;
  }
  const dropIndex = direction === 'up' ? from - 1 : to + 2;
  const nextRange = selectionAfterMove(from, to, dropIndex);
  const tr = finishBlockRangeTransaction(moved, nextRange.from, nextRange.to);
  if (dispatch === undefined) {
    return true;
  }
  dispatch(tr);
  return true;
}

export function moveBlocksUpCommand(): Command {
  return (state, dispatch) => runBlockMove(state, 'up', dispatch);
}

export function moveBlocksDownCommand(): Command {
  return (state, dispatch) => runBlockMove(state, 'down', dispatch);
}

export function duplicateBlocksCommand(): Command {
  return (state, dispatch) => {
    const { from, to } = activeBlockRange(state);
    const tr = duplicateBlocksInRange(state.tr, from, to, newBlockId);
    if (dispatch === undefined) {
      return true;
    }
    dispatch(tr);
    return true;
  };
}

export function moveBlockRangeToDropCommand(
  from: number,
  to: number,
  dropIndex: number,
): Command {
  return (state, dispatch) => {
    const moved = moveBlockRangeTo(state.tr, from, to, dropIndex);
    if (moved === null) {
      return false;
    }
    const nextRange = selectionAfterMove(from, to, dropIndex);
    const tr = finishBlockRangeTransaction(moved, nextRange.from, nextRange.to);
    if (dispatch === undefined) {
      return true;
    }
    dispatch(tr);
    return true;
  };
}

export function blockMoveKeymap(): Record<string, Command> {
  return {
    'Alt-Shift-ArrowUp': moveBlocksUpCommand(),
    'Alt-Shift-ArrowDown': moveBlocksDownCommand(),
    'Mod-d': duplicateBlocksCommand(),
  };
}
