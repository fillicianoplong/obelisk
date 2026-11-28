import type { Command, EditorState, Transaction } from 'prosemirror-state';
import type { JsonObject } from '../../../shared/ipc/types.js';
import type { TableBlock } from '../../../shared/schema/types.js';
import { caretBlockIndex } from '../../editor/block-handle-plugin.js';
import { newBlockId } from '../../editor/block-id.js';
import { markCloseHistoryGroup } from '../../editor/history/groups.js';
import { parsePayload, stringifyPayload } from '../structured/payload.js';
import {
  defaultTableBody,
  parseTablePayload,
  tablePayloadFromBlock,
  tablePayloadString,
} from './document.js';
import {
  applyStructureChange,
  canGrowColumns,
  canGrowRows,
  setCellText,
  sortTable,
  toggleHeaderRow,
} from './model.js';
import { blockStartPos } from './position.js';
import { setTableSelection, tableSelectionState } from './selection.js';

function insertTablePos(tr: Transaction, after: number | undefined): number {
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

function tableFromNode(node: { attrs: Record<string, unknown> }): TableBlock | null {
  return parseTablePayload(node.attrs);
}

function replaceTablePayload(
  tr: Transaction,
  blockIndex: number,
  table: TableBlock,
): Transaction {
  const pos = blockStartPos(tr.doc, blockIndex);
  const node = tr.doc.child(blockIndex);
  if (node.type.name !== 'structured_block') {
    return tr;
  }
  const payload = stringifyPayload(tablePayloadFromBlock(table as unknown as JsonObject));
  return tr.setNodeMarkup(pos, undefined, {
    ...node.attrs,
    blockId: table.id,
    blockType: 'table',
    payload,
  });
}

function withTableAt(
  state: EditorState,
  blockIndex: number,
  fn: (table: TableBlock) => TableBlock | null,
): Transaction | null {
  const node = state.doc.child(blockIndex);
  const table = tableFromNode(node);
  if (table === null) {
    return null;
  }
  const next = fn(table);
  if (next === null) {
    return null;
  }
  return replaceTablePayload(state.tr, blockIndex, next);
}

function activeTableAddress(state: EditorState): { blockIndex: number; row: number; col: number } | null {
  const active = tableSelectionState(state).active;
  if (active === null) {
    return null;
  }
  const node = state.doc.child(active.blockIndex);
  if (node.type.name !== 'structured_block' || node.attrs.blockType !== 'table') {
    return null;
  }
  return active;
}

export function insertTableCommand(): Command {
  return (state, dispatch) => {
    const blockId = newBlockId();
    const body = defaultTableBody();
    const payload = stringifyPayload({
      headerRow: body.headerRow,
      columnWidths: body.columnWidths,
      rows: body.rows as never,
    });
    const node = state.schema.nodes.structured_block.create({
      blockId,
      blockType: 'table',
      payload,
    });
    const after = caretBlockIndex(state);
    const tr = state.tr.insert(insertTablePos(state.tr, after), node);
    if (dispatch) {
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export function updateTableCellCommand(
  blockIndex: number,
  row: number,
  col: number,
  text: string,
): Command {
  return (state, dispatch) => {
    const tr = withTableAt(state, blockIndex, (table) => setCellText(table, row, col, text));
    if (tr === null) {
      return false;
    }
    if (dispatch) {
      dispatch(tr);
    }
    return true;
  };
}

function structureCommand(
  change: Parameters<typeof applyStructureChange>[1],
): Command {
  return (state, dispatch) => {
    const active = activeTableAddress(state);
    if (active === null) {
      return false;
    }
    const node = state.doc.child(active.blockIndex);
    const current = tableFromNode(node);
    if (current !== null) {
      const count = change.count ?? 1;
      if (change.kind === 'insert-rows' && !canGrowRows(current, count)) {
        return false;
      }
      if (change.kind === 'insert-columns' && !canGrowColumns(current, count)) {
        return false;
      }
    }
    const tr = withTableAt(state, active.blockIndex, (table) => applyStructureChange(table, change));
    if (tr === null) {
      return false;
    }
    if (dispatch) {
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export function tableInsertRowAboveCommand(): Command {
  return (state, dispatch) => {
    const active = activeTableAddress(state);
    if (active === null) {
      return false;
    }
    return structureCommand({ kind: 'insert-rows', row: active.row + 1 })(state, dispatch);
  };
}

export function tableInsertRowBelowCommand(): Command {
  return (state, dispatch) => {
    const active = activeTableAddress(state);
    if (active === null) {
      return false;
    }
    return structureCommand({ kind: 'insert-rows', row: active.row + 2 })(state, dispatch);
  };
}

export function tableInsertColumnLeftCommand(): Command {
  return (state, dispatch) => {
    const active = activeTableAddress(state);
    if (active === null) {
      return false;
    }
    return structureCommand({ kind: 'insert-columns', column: active.col + 1 })(state, dispatch);
  };
}

export function tableInsertColumnRightCommand(): Command {
  return (state, dispatch) => {
    const active = activeTableAddress(state);
    if (active === null) {
      return false;
    }
    return structureCommand({ kind: 'insert-columns', column: active.col + 2 })(state, dispatch);
  };
}

export function tableDeleteRowCommand(): Command {
  return (state, dispatch) => {
    const active = activeTableAddress(state);
    if (active === null) {
      return false;
    }
    return structureCommand({ kind: 'delete-rows', row: active.row + 1 })(state, dispatch);
  };
}

export function tableDeleteColumnCommand(): Command {
  return (state, dispatch) => {
    const active = activeTableAddress(state);
    if (active === null) {
      return false;
    }
    return structureCommand({ kind: 'delete-columns', column: active.col + 1 })(state, dispatch);
  };
}

export function tableSortAscendingCommand(): Command {
  return (state, dispatch) => sortByActiveColumn(state, dispatch, true);
}

export function tableSortDescendingCommand(): Command {
  return (state, dispatch) => sortByActiveColumn(state, dispatch, false);
}

function sortByActiveColumn(
  state: EditorState,
  dispatch: ((tr: Transaction) => void) | undefined,
  ascending: boolean,
): boolean {
  const active = activeTableAddress(state);
  if (active === null) {
    return false;
  }
  const tr = withTableAt(state, active.blockIndex, (table) => sortTable(table, active.col, ascending));
  if (tr === null) {
    return false;
  }
  if (dispatch) {
    dispatch(markCloseHistoryGroup(tr));
  }
  return true;
}

export function tableHeaderRowCommand(): Command {
  return (state, dispatch) => {
    const active = activeTableAddress(state);
    if (active === null) {
      return false;
    }
    const tr = withTableAt(state, active.blockIndex, (table) => toggleHeaderRow(table));
    if (tr === null) {
      return false;
    }
    if (dispatch) {
      dispatch(tr);
    }
    return true;
  };
}

export function tableMenuCommand(menuId: string): Command | null {
  switch (menuId) {
    case 'insert-table':
      return insertTableCommand();
    case 'table-insert-row-above':
      return tableInsertRowAboveCommand();
    case 'table-insert-row-below':
      return tableInsertRowBelowCommand();
    case 'table-insert-column-left':
      return tableInsertColumnLeftCommand();
    case 'table-insert-column-right':
      return tableInsertColumnRightCommand();
    case 'table-delete-row':
      return tableDeleteRowCommand();
    case 'table-delete-column':
      return tableDeleteColumnCommand();
    case 'table-sort-ascending':
      return tableSortAscendingCommand();
    case 'table-sort-descending':
      return tableSortDescendingCommand();
    case 'table-header-row':
      return tableHeaderRowCommand();
    default:
      return null;
  }
}

export function tableCommandEnabled(state: EditorState, menuId: string): boolean {
  if (menuId === 'insert-table') {
    return insertTableCommand()(state);
  }
  if (!menuId.startsWith('table-')) {
    return false;
  }
  return activeTableAddress(state) !== null;
}

export function tableBlockJsonFromAttrs(
  blockId: string,
  attrs: Record<string, unknown>,
): JsonObject {
  const payload = parsePayload(attrs.payload);
  const merged = payload ?? {};
  return {
    type: 'table',
    id: blockId,
    headerRow: merged.headerRow === true,
    columnWidths: Array.isArray(merged.columnWidths) ? merged.columnWidths : [],
    rows: Array.isArray(merged.rows) ? merged.rows : [],
  };
}

export function createTableNode(
  schema: EditorState['schema'],
  block: JsonObject,
  blockId: string,
): ReturnType<EditorState['schema']['nodes']['structured_block']['create']> {
  return schema.nodes.structured_block.create({
    blockId,
    blockType: 'table',
    payload: tablePayloadString(block),
  });
}

export { setTableSelection };