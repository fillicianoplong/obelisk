import type { Command, EditorState, Transaction } from 'prosemirror-state';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import { Node as ProseNode } from 'prosemirror-model';
import { newBlockId } from './block-id.js';
import {
  blockHandlePluginKey,
  blockPosAtIndex,
  caretBlockIndex,
  emptyBlockHandleState,
  selectedBlockIds,
  selectedBlockIndices,
} from './block-handle-plugin.js';
import type { BlockHandleState } from './block-handle-plugin.js';

function indicesAreContiguous(indices: readonly number[]): boolean {
  if (indices.length <= 1) {
    return true;
  }
  const sorted = [...indices].sort((left, right) => left - right);
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] !== sorted[index - 1] + 1) {
      return false;
    }
  }
  return true;
}

export function activeBlockRange(state: EditorState): { from: number; to: number } {
  const indices = selectedBlockIndices(state);
  if (indices.length > 0) {
    return { from: indices[0], to: indices[indices.length - 1] };
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

function deleteBlockAtIndex(tr: Transaction, index: number): Transaction {
  const start = blockPosAtIndex(tr.doc, index);
  const end = start + tr.doc.child(index).nodeSize;
  return tr.delete(start, end);
}

function deleteBlocksAtIndices(tr: Transaction, indices: readonly number[]): Transaction {
  let next = tr;
  const sorted = [...indices].sort((left, right) => right - left);
  for (const index of sorted) {
    next = deleteBlockAtIndex(next, index);
  }
  return next;
}

function deleteBlockRange(tr: Transaction, from: number, to: number): Transaction {
  return deleteBlocksAtIndices(tr, rangeIndices(from, to));
}

function rangeIndices(from: number, to: number): number[] {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const indices: number[] = [];
  for (let index = start; index <= end; index += 1) {
    indices.push(index);
  }
  return indices;
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

function moveBlockRangeTo(
  tr: Transaction,
  from: number,
  to: number,
  dropIndex: number,
): Transaction | null {
  return moveBlocksAtIndicesTo(tr, rangeIndices(from, to), dropIndex);
}

/**
 * Move the given blocks to `dropIndex` (0..childCount), preserving their relative order.
 * Returns null when the range would not move.
 */
export function moveBlocksAtIndicesTo(
  tr: Transaction,
  indices: readonly number[],
  dropIndex: number,
): Transaction | null {
  if (indices.length === 0) {
    return null;
  }
  const sorted = [...indices].sort((left, right) => left - right);
  const from = sorted[0];
  const to = sorted[sorted.length - 1];
  const { doc } = tr;
  if (dropIndex < 0 || dropIndex > doc.childCount) {
    return null;
  }
  if (dropIndex >= from && dropIndex <= to + 1) {
    return null;
  }
  const nodes = blockNodes(doc, from, to);
  if (sorted.length !== to - from + 1) {
    const picked = sorted.map((index) => doc.child(index));
    let next = deleteBlocksAtIndices(tr, sorted);
    let insertIndex = dropIndex;
    for (const index of sorted) {
      if (index < dropIndex) {
        insertIndex -= 1;
      }
    }
    return insertBlocksAtIndex(next, insertIndex, picked);
  }
  let next = deleteBlockRange(tr, from, to);
  let insertIndex = dropIndex;
  if (dropIndex > to) {
    insertIndex = dropIndex - (to - from + 1);
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
  const ids: string[] = [];
  for (let index = from; index <= to; index += 1) {
    const raw = tr.doc.child(index).attrs.blockId;
    if (typeof raw === 'string' && raw.length > 0) {
      ids.push(raw);
    }
  }
  return finishBlockSelectionTransaction(tr, ids, from);
}

export function finishBlockSelectionTransaction(
  tr: Transaction,
  ids: readonly string[],
  anchor: number,
): Transaction {
  const present: number[] = [];
  const orderedIds: string[] = [];
  for (let index = 0; index < tr.doc.childCount; index += 1) {
    const raw = tr.doc.child(index).attrs.blockId;
    const blockId = typeof raw === 'string' ? raw : '';
    if (blockId.length > 0 && ids.includes(blockId)) {
      present.push(index);
      orderedIds.push(blockId);
    }
  }
  let from: number | null = null;
  let to: number | null = null;
  if (present.length > 0 && indicesAreContiguous(present)) {
    from = present[0];
    to = present[present.length - 1];
  }
  const focus = present[0] ?? 0;
  const nodePos = blockPosAtIndex(tr.doc, focus);
  const handleState: BlockHandleState = {
    ...emptyBlockHandleState(),
    anchor,
    from,
    to,
    selectedIds: orderedIds.length > 0 ? orderedIds : null,
    drag: null,
  };
  return tr
    .setSelection(NodeSelection.create(tr.doc, nodePos))
    .setMeta('blockHandleKeep', true)
    .setMeta(blockHandlePluginKey, handleState);
}

function duplicateBlocksAtIndices(
  tr: Transaction,
  indices: readonly number[],
  mint: () => string,
): Transaction {
  const sorted = [...indices].sort((left, right) => right - left);
  const newIds: string[] = [];
  let next = tr;
  for (const index of sorted) {
    const node = next.doc.child(index);
    const json = node.toJSON() as { type: string; attrs?: Record<string, unknown> };
    const fresh = mint();
    json.attrs = { ...(json.attrs ?? {}), blockId: fresh };
    newIds.unshift(fresh);
    const copy = ProseNode.fromJSON(next.doc.type.schema, json);
    const pos = blockPosAtIndex(next.doc, index) + next.doc.child(index).nodeSize;
    next = next.insert(pos, copy);
  }
  const anchor = sorted[sorted.length - 1] ?? 0;
  return finishBlockSelectionTransaction(next, newIds, anchor);
}

export function duplicateBlocksInRange(
  tr: Transaction,
  from: number,
  to: number,
  mint: () => string,
): Transaction {
  const nodes: ProseNode[] = [];
  const newIds: string[] = [];
  for (let index = from; index <= to; index += 1) {
    const node = tr.doc.child(index);
    const json = node.toJSON() as { type: string; attrs?: Record<string, unknown> };
    const fresh = mint();
    json.attrs = { ...(json.attrs ?? {}), blockId: fresh };
    newIds.push(fresh);
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
  const indices = selectedBlockIndices(state);
  const range = activeBlockRange(state);
  const { from, to } = range;
  if (indices.length > 0 && !indicesAreContiguous(indices)) {
    return false;
  }
  const moved = direction === 'up'
    ? moveBlocksUp(state.tr, from, to)
    : moveBlocksDown(state.tr, from, to);
  if (moved === null) {
    return false;
  }
  if (dispatch === undefined) {
    return true;
  }
  const dropIndex = direction === 'up' ? from - 1 : to + 2;
  const nextRange = selectionAfterMove(from, to, dropIndex);
  const tr = finishBlockRangeTransaction(moved, nextRange.from, nextRange.to);
  dispatch(tr);
  return true;
}

export function moveBlocksUpCommand(): Command {
  return (state, dispatch) => runBlockMove(state, 'up', dispatch);
}

export function moveBlocksDownCommand(): Command {
  return (state, dispatch) => runBlockMove(state, 'down', dispatch);
}

export function deleteSelectedBlocksCommand(): Command {
  return (state, dispatch) => {
    const indices = selectedBlockIndices(state);
    const range = activeBlockRange(state);
    const targets = indices.length > 0 ? indices : rangeIndices(range.from, range.to);
    if (targets.some((index) => index < 0 || index >= state.doc.childCount)) {
      return false;
    }
    if (state.doc.childCount === 1 && targets.length === 1 && targets[0] === 0) {
      return false;
    }
    if (dispatch === undefined) {
      return true;
    }
    let tr = deleteBlocksAtIndices(state.tr, targets);
    if (tr.doc.childCount === 0) {
      return false;
    }
    const nextIndex = Math.min(targets[0], tr.doc.childCount - 1);
    const inner = blockPosAtIndex(tr.doc, nextIndex) + 1;
    tr = tr.setMeta(blockHandlePluginKey, emptyBlockHandleState());
    try {
      tr = tr.setSelection(TextSelection.create(tr.doc, inner));
    } catch {
      const pos = Math.max(0, Math.min(inner, tr.doc.content.size));
      tr = tr.setSelection(TextSelection.near(tr.doc.resolve(pos), -1));
    }
    dispatch(tr);
    return true;
  };
}

export function duplicateBlocksCommand(): Command {
  return (state, dispatch) => {
    const indices = selectedBlockIndices(state);
    if (indices.length > 0) {
      if (indices.some((index) => index < 0 || index >= state.doc.childCount)) {
        return false;
      }
      if (dispatch === undefined) {
        return true;
      }
      const tr = indicesAreContiguous(indices)
        ? duplicateBlocksInRange(state.tr, indices[0], indices[indices.length - 1], newBlockId)
        : duplicateBlocksAtIndices(state.tr, indices, newBlockId);
      dispatch(tr);
      return true;
    }
    const { from, to } = activeBlockRange(state);
    if (from < 0 || to >= state.doc.childCount) {
      return false;
    }
    if (dispatch === undefined) {
      return true;
    }
    const tr = duplicateBlocksInRange(state.tr, from, to, newBlockId);
    dispatch(tr);
    return true;
  };
}

export function moveSelectedBlocksToDropCommand(
  sourceIndices: number[],
  dropIndex: number,
): Command {
  return (state, dispatch) => {
    const ids = selectedBlockIds(state);
    const moved = moveBlocksAtIndicesTo(state.tr, sourceIndices, dropIndex);
    if (moved === null) {
      return false;
    }
    if (dispatch === undefined) {
      return true;
    }
    const anchor = Math.min(...sourceIndices);
    const tr = ids.length > 0
      ? finishBlockSelectionTransaction(moved, ids, anchor)
      : finishBlockRangeTransaction(
        moved,
        selectionAfterMove(sourceIndices[0], sourceIndices[sourceIndices.length - 1], dropIndex).from,
        selectionAfterMove(sourceIndices[0], sourceIndices[sourceIndices.length - 1], dropIndex).to,
      );
    dispatch(tr);
    return true;
  };
}

export function moveBlockRangeToDropCommand(
  from: number,
  to: number,
  dropIndex: number,
): Command {
  return moveSelectedBlocksToDropCommand(rangeIndices(from, to), dropIndex);
}

export function blockMoveKeymap(): Record<string, Command> {
  return {
    'Alt-Shift-ArrowUp': moveBlocksUpCommand(),
    'Alt-Shift-ArrowDown': moveBlocksDownCommand(),
    'Mod-d': duplicateBlocksCommand(),
  };
}