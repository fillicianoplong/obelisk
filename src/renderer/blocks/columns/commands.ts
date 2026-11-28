import type { Command, EditorState, Transaction } from 'prosemirror-state';
import { NodeSelection } from 'prosemirror-state';
import type { JsonObject } from '../../../shared/ipc/types.js';
import type { ColumnsBlock, NestedBlock } from '../../../shared/schema/types.js';
import { caretBlockIndex } from '../../editor/block-handle-plugin.js';
import { blockPosAtIndex } from '../../editor/block-handle-plugin.js';
import { newBlockId } from '../../editor/block-id.js';
import { blockJsonFromNode, blockNodeFromJson } from '../../editor/schema/mapping.js';
import { parsePayload, stringifyPayload } from '../structured/payload.js';
import { blockStartPos } from '../table/position.js';
import {
  columnsBlockFromPayload,
  columnsPayloadFromBlock,
  columnsPayloadString,
  defaultColumnsBody,
  emptyParagraph,
  parseColumnsPayload,
} from './document.js';
import {
  addColumn,
  insertNestedBlock,
  moveNestedBetweenColumns,
  nestedBlockFromTopLevelJson,
  removeColumn,
  removeNestedBlock,
  resizePair,
  setEvenWidths,
} from './model.js';

function insertStructuredPos(tr: Transaction, after: number | undefined): number {
  if (after === undefined || after < 0 || after >= tr.doc.childCount) {
    let pos = 0;
    for (let index = 0; index < tr.doc.childCount; index += 1) {
      pos += tr.doc.child(index).nodeSize;
    }
    return pos;
  }
  let pos = 0;
  for (let index = 0; index <= after; index += 1) {
    pos += tr.doc.child(index).nodeSize;
  }
  return pos;
}

function columnsFromNode(node: { attrs: Record<string, unknown> }): ColumnsBlock | null {
  return parseColumnsPayload(node.attrs);
}

function replaceColumnsPayload(tr: Transaction, blockIndex: number, columns: ColumnsBlock): Transaction {
  const pos = blockStartPos(tr.doc, blockIndex);
  const node = tr.doc.child(blockIndex);
  if (node.type.name !== 'structured_block' || node.attrs.blockType !== 'columns') {
    return tr;
  }
  const payload = stringifyPayload(columnsPayloadFromBlock(columns as unknown as JsonObject));
  return tr.setNodeMarkup(pos, undefined, {
    ...node.attrs,
    blockId: columns.id,
    blockType: 'columns',
    payload,
  });
}

function withColumnsAt(
  state: EditorState,
  blockIndex: number,
  fn: (columns: ColumnsBlock) => ColumnsBlock | null,
): Transaction | null {
  const node = state.doc.child(blockIndex);
  const columns = columnsFromNode(node);
  if (columns === null) {
    return null;
  }
  const next = fn(columns);
  if (next === null) {
    return null;
  }
  return replaceColumnsPayload(state.tr, blockIndex, next);
}

export function activeColumnsBlockIndex(state: EditorState): number | null {
  if (state.selection instanceof NodeSelection && state.selection.$anchor.depth === 0) {
    const node = state.selection.node;
    if (node.type.name === 'structured_block' && node.attrs.blockType === 'columns') {
      return state.selection.$anchor.index(0);
    }
  }
  const index = caretBlockIndex(state);
  const node = state.doc.child(index);
  if (node.type.name === 'structured_block' && node.attrs.blockType === 'columns') {
    return index;
  }
  return null;
}

export function insertColumnsCommand(columnCount = 2): Command {
  return (state, dispatch) => {
    const blockId = newBlockId();
    const body = defaultColumnsBody(columnCount);
    const payload = stringifyPayload(columnsPayloadFromBlock(body as unknown as JsonObject));
    const node = state.schema.nodes.structured_block.create({
      blockId,
      blockType: 'columns',
      payload,
    });
    const after = caretBlockIndex(state);
    const tr = state.tr.insert(insertStructuredPos(state.tr, after), node);
    if (dispatch) {
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export function columnAddCommand(): Command {
  return (state, dispatch) => {
    const blockIndex = activeColumnsBlockIndex(state);
    if (blockIndex === null) {
      return false;
    }
    const tr = withColumnsAt(state, blockIndex, (columns) => addColumn(columns));
    if (tr === null) {
      return false;
    }
    if (dispatch) {
      dispatch(tr);
    }
    return true;
  };
}

export function columnRemoveCommand(): Command {
  return (state, dispatch) => {
    const blockIndex = activeColumnsBlockIndex(state);
    if (blockIndex === null) {
      return false;
    }
    const tr = withColumnsAt(state, blockIndex, (columns) => {
      if (columns.columns.length <= 2) {
        return removeColumn(columns, columns.columns.length - 1);
      }
      return removeColumn(columns, columns.columns.length - 1);
    });
    if (tr === null) {
      return false;
    }
    if (dispatch) {
      dispatch(tr);
    }
    return true;
  };
}

export function columnEvenWidthsCommand(): Command {
  return (state, dispatch) => {
    const blockIndex = activeColumnsBlockIndex(state);
    if (blockIndex === null) {
      return false;
    }
    const tr = withColumnsAt(state, blockIndex, (columns) => setEvenWidths(columns));
    if (tr === null) {
      return false;
    }
    if (dispatch) {
      dispatch(tr);
    }
    return true;
  };
}

export function updateColumnsSharesCommand(
  blockIndex: number,
  leftIndex: number,
  leftShare: number,
  rightShare: number,
): Command {
  return (state, dispatch) => {
    const tr = withColumnsAt(state, blockIndex, (columns) => resizePair(columns, leftIndex, leftShare, rightShare));
    if (tr === null) {
      return false;
    }
    if (dispatch) {
      dispatch(tr);
    }
    return true;
  };
}

export function updateColumnsBodyCommand(blockIndex: number, columns: ColumnsBlock): Command {
  return (state, dispatch) => {
    const tr = replaceColumnsPayload(state.tr, blockIndex, columns);
    if (dispatch) {
      dispatch(tr);
    }
    return true;
  };
}

export function moveTopLevelBlocksIntoColumn(
  state: EditorState,
  sourceFrom: number,
  sourceTo: number,
  targetBlockIndex: number,
  columnIndex: number,
): Transaction | null {
  const target = state.doc.child(targetBlockIndex);
  if (target.type.name !== 'structured_block' || target.attrs.blockType !== 'columns') {
    return null;
  }
  const nested: NestedBlock[] = [];
  for (let index = sourceFrom; index <= sourceTo; index += 1) {
    if (index === targetBlockIndex) {
      return null;
    }
    const node = state.doc.child(index);
    const json = blockJsonFromNode(node, null, newBlockId);
    const block = nestedBlockFromTopLevelJson(json);
    if (block === null) {
      return null;
    }
    nested.push(block);
  }
  let tr = state.tr;
  const deleteStart = blockPosAtIndex(tr.doc, sourceFrom);
  const deleteEnd = blockPosAtIndex(tr.doc, sourceTo) + tr.doc.child(sourceTo).nodeSize;
  tr = tr.delete(deleteStart, deleteEnd);
  let offset = 0;
  if (sourceFrom < targetBlockIndex) {
    offset = sourceTo - sourceFrom + 1;
  }
  const adjustedIndex = targetBlockIndex - offset;
  const columns = columnsFromNode(tr.doc.child(adjustedIndex));
  if (columns === null) {
    return null;
  }
  let next = columns;
  for (let index = 0; index < nested.length; index += 1) {
    const column = next.columns[columnIndex];
    const at = column?.blocks.length ?? 0;
    const updated = insertNestedBlock(next, columnIndex, at, nested[index]!);
    if (updated === null) {
      return null;
    }
    next = updated;
  }
  return replaceColumnsPayload(tr, adjustedIndex, next);
}

export function moveNestedBlockToTopLevel(
  state: EditorState,
  blockIndex: number,
  columnIndex: number,
  nestedIndex: number,
  dropIndex: number,
): Transaction | null {
  const node = state.doc.child(blockIndex);
  const columns = columnsFromNode(node);
  if (columns === null) {
    return null;
  }
  const column = columns.columns[columnIndex];
  const block = column?.blocks[nestedIndex];
  if (block === undefined) {
    return null;
  }
  const nextColumns = removeNestedBlock(columns, columnIndex, nestedIndex);
  if (nextColumns === null) {
    return null;
  }
  const topNode = blockNodeFromJson({ ...block, id: block.id || newBlockId() } as JsonObject, state.schema);
  if (topNode === null) {
    return null;
  }
  const onlyOneBlockLeft = nextColumns.columns.flatMap((entry) => entry.blocks).length === 1;
  if (onlyOneBlockLeft) {
    const remaining = nextColumns.columns.flatMap((entry) => entry.blocks)[0]!;
    const loneNode = blockNodeFromJson({ ...remaining, id: remaining.id || newBlockId() } as JsonObject, state.schema);
    if (loneNode === null) {
      return null;
    }
    const start = blockPosAtIndex(state.doc, blockIndex);
    const end = start + node.nodeSize;
    const insertAt = Math.max(0, Math.min(dropIndex, state.doc.childCount));
    const insertPos = insertAt >= state.doc.childCount
      ? state.doc.content.size
      : blockPosAtIndex(state.doc, insertAt);
    return state.tr.delete(start, end).insert(insertPos, loneNode);
  }
  let tr = replaceColumnsPayload(state.tr, blockIndex, nextColumns);
  const insertAt = Math.max(0, Math.min(dropIndex, tr.doc.childCount));
  const insertPos = insertAt >= tr.doc.childCount
    ? tr.doc.content.size
    : blockPosAtIndex(tr.doc, insertAt);
  return tr.insert(insertPos, topNode);
}

export function createColumnRowFromPair(
  state: EditorState,
  leftIndex: number,
  rightIndex: number,
  side: 'left' | 'right',
): Transaction | null {
  const leftNode = state.doc.child(leftIndex);
  const rightNode = state.doc.child(rightIndex);
  const leftJson = blockJsonFromNode(leftNode, null, newBlockId);
  const rightJson = blockJsonFromNode(rightNode, null, newBlockId);
  const leftBlock = nestedBlockFromTopLevelJson(leftJson);
  const rightBlock = nestedBlockFromTopLevelJson(rightJson);
  if (leftBlock === null || rightBlock === null) {
    return null;
  }
  const ordered = side === 'left' ? [rightBlock, leftBlock] : [leftBlock, rightBlock];
  const blockId = newBlockId();
  const columns: ColumnsBlock = {
    type: 'columns',
    id: blockId,
    columns: [
      { share: 0.5, blocks: [ordered[0]!] },
      { share: 0.5, blocks: [ordered[1]!] },
    ],
  };
  const payload = stringifyPayload(columnsPayloadFromBlock(columns as unknown as JsonObject));
  const rowNode = state.schema.nodes.structured_block.create({
    blockId,
    blockType: 'columns',
    payload,
  });
  const first = Math.min(leftIndex, rightIndex);
  const last = Math.max(leftIndex, rightIndex);
  const start = blockPosAtIndex(state.doc, first);
  const end = blockPosAtIndex(state.doc, last) + state.doc.child(last).nodeSize;
  return state.tr.replaceWith(start, end, rowNode);
}

export function columnsMenuCommand(menuId: string): Command | null {
  switch (menuId) {
    case 'insert-columns':
      return insertColumnsCommand(2);
    case 'column-add':
      return columnAddCommand();
    case 'column-remove':
      return columnRemoveCommand();
    case 'column-even-widths':
      return columnEvenWidthsCommand();
    default:
      return null;
  }
}

export function columnsCommandEnabled(state: EditorState, menuId: string): boolean {
  if (menuId === 'insert-columns') {
    return insertColumnsCommand()(state);
  }
  if (menuId === 'column-add' || menuId === 'column-remove' || menuId === 'column-even-widths') {
    return activeColumnsBlockIndex(state) !== null;
  }
  return false;
}

export function columnsBlockJsonFromAttrs(
  blockId: string,
  attrs: Record<string, unknown>,
): JsonObject {
  const payload = parsePayload(attrs.payload);
  const merged = payload ?? {};
  const columns = columnsBlockFromPayload(blockId, merged);
  return {
    type: 'columns',
    id: blockId,
    columns: columns.columns as never,
  };
}

export function createColumnsNode(
  schema: EditorState['schema'],
  block: JsonObject,
  blockId: string,
): ReturnType<EditorState['schema']['nodes']['structured_block']['create']> {
  return schema.nodes.structured_block.create({
    blockId,
    blockType: 'columns',
    payload: columnsPayloadString(block),
  });
}

export function commitNestedColumnChange(
  columns: ColumnsBlock,
  columnIndex: number,
  blocks: NestedBlock[],
): ColumnsBlock {
  const next = columns.columns.map((column, index) => (index === columnIndex
    ? { ...column, blocks: blocks.length > 0 ? blocks : [emptyNested()] }
    : column));
  return { ...columns, columns: next };
}

function emptyNested(): NestedBlock {
  return emptyParagraph(newBlockId());
}

export function moveNestedInColumn(
  columns: ColumnsBlock,
  columnIndex: number,
  from: number,
  to: number,
): ColumnsBlock | null {
  const column = columns.columns[columnIndex];
  if (column === undefined) {
    return null;
  }
  const blocks = column.blocks.slice();
  if (from < 0 || from >= blocks.length || to < 0 || to > blocks.length) {
    return null;
  }
  const [item] = blocks.splice(from, 1);
  if (item === undefined) {
    return null;
  }
  const adjusted = from < to ? to - 1 : to;
  blocks.splice(adjusted, 0, item);
  return commitNestedColumnChange(columns, columnIndex, blocks);
}

export { moveNestedBetweenColumns };