import { redo, undo } from 'prosemirror-history';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import { NodeSelection } from 'prosemirror-state';
import type { JsonObject } from '../../../shared/ipc/types.js';
import type { DrawingBlock, Stroke } from '../../../shared/schema/types.js';
import { caretBlockIndex } from '../../editor/block-handle-plugin.js';
import { newBlockId } from '../../editor/block-id.js';
import { markCloseHistoryGroup } from '../../editor/history/groups.js';
import { parsePayload, stringifyPayload } from '../structured/payload.js';
import { blockStartPos } from '../table/position.js';
import {
  defaultDrawingBody,
  drawingBlockFromPayload,
  drawingPayloadFromBlock,
  drawingPayloadString,
  parseDrawingPayload,
  DEFAULT_DRAWING_HEIGHT,
  DEFAULT_DRAWING_WIDTH,
} from './document.js';

function insertDrawingPos(tr: Transaction, after: number | undefined): number {
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

function drawingFromNode(node: { attrs: Record<string, unknown> }): DrawingBlock | null {
  return parseDrawingPayload(node.attrs);
}

function replaceDrawingPayload(
  tr: Transaction,
  blockIndex: number,
  drawing: DrawingBlock,
): Transaction {
  const pos = blockStartPos(tr.doc, blockIndex);
  const node = tr.doc.child(blockIndex);
  if (node.type.name !== 'structured_block' || node.attrs.blockType !== 'drawing') {
    return tr;
  }
  const payload = stringifyPayload(drawingPayloadFromBlock(drawing as unknown as JsonObject));
  return markCloseHistoryGroup(tr.setNodeMarkup(pos, undefined, {
    ...node.attrs,
    blockId: drawing.id,
    blockType: 'drawing',
    payload,
  }));
}

function withDrawingAt(
  state: EditorState,
  blockIndex: number,
  fn: (drawing: DrawingBlock) => DrawingBlock | null,
): Transaction | null {
  const node = state.doc.child(blockIndex);
  const drawing = drawingFromNode(node);
  if (drawing === null) {
    return null;
  }
  const next = fn(drawing);
  if (next === null) {
    return null;
  }
  return replaceDrawingPayload(state.tr, blockIndex, next);
}

function selectedDrawingIndex(state: EditorState): number | null {
  const { selection } = state;
  if (selection instanceof NodeSelection
    && selection.node.type.name === 'structured_block'
    && selection.node.attrs.blockType === 'drawing') {
    return selection.$from.index(0);
  }
  const index = caretBlockIndex(state);
  if (index < 0 || index >= state.doc.childCount) {
    return null;
  }
  const node = state.doc.child(index);
  if (node.type.name === 'structured_block' && node.attrs.blockType === 'drawing') {
    return index;
  }
  return null;
}

export function insertDrawingCommand(): Command {
  return (state, dispatch) => {
    const blockId = newBlockId();
    const body = defaultDrawingBody();
    const payload = stringifyPayload(drawingPayloadFromBlock(body as unknown as JsonObject));
    const node = state.schema.nodes.structured_block.create({
      blockId,
      blockType: 'drawing',
      payload,
    });
    const after = caretBlockIndex(state);
    const tr = state.tr.insert(insertDrawingPos(state.tr, after), node);
    if (dispatch) {
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export function updateDrawingStrokesCommand(
  blockIndex: number,
  strokes: Stroke[],
  size?: { width?: number; height?: number },
): Command {
  return (state, dispatch) => {
    const tr = withDrawingAt(state, blockIndex, (drawing) => ({
      ...drawing,
      width: size?.width ?? drawing.width,
      height: size?.height ?? drawing.height,
      strokes,
    }));
    if (tr === null) {
      return false;
    }
    if (dispatch) {
      dispatch(tr);
    }
    return true;
  };
}

export function drawingClearCommand(): Command {
  return (state, dispatch) => {
    const index = selectedDrawingIndex(state);
    if (index === null) {
      return false;
    }
    const tr = withDrawingAt(state, index, (drawing) => ({ ...drawing, strokes: [] }));
    if (tr === null) {
      return false;
    }
    if (dispatch) {
      dispatch(tr);
    }
    return true;
  };
}

export function drawingResetSizeCommand(): Command {
  return (state, dispatch) => {
    const index = selectedDrawingIndex(state);
    if (index === null) {
      return false;
    }
    const tr = withDrawingAt(state, index, (drawing) => ({
      ...drawing,
      width: DEFAULT_DRAWING_WIDTH,
      height: DEFAULT_DRAWING_HEIGHT,
    }));
    if (tr === null) {
      return false;
    }
    if (dispatch) {
      dispatch(tr);
    }
    return true;
  };
}

export function drawingUndoCommand(): Command {
  return undo;
}

export function drawingRedoCommand(): Command {
  return redo;
}

export function drawingMenuCommand(menuId: string): Command | null {
  switch (menuId) {
    case 'insert-drawing':
      return insertDrawingCommand();
    case 'drawing-clear':
      return drawingClearCommand();
    case 'drawing-reset-size':
      return drawingResetSizeCommand();
    case 'drawing-undo':
      return drawingUndoCommand();
    case 'drawing-redo':
      return drawingRedoCommand();
    default:
      return null;
  }
}

export function drawingCommandEnabled(state: EditorState, menuId: string): boolean {
  if (menuId === 'insert-drawing') {
    return insertDrawingCommand()(state);
  }
  if (menuId.startsWith('drawing-')) {
    const command = drawingMenuCommand(menuId);
    return command !== null ? command(state) : false;
  }
  return false;
}

export function drawingBlockJsonFromAttrs(
  blockId: string,
  attrs: Record<string, unknown>,
): JsonObject {
  const payload = parsePayload(attrs.payload);
  const merged = payload ?? {};
  return {
    type: 'drawing',
    id: blockId,
    width: typeof merged.width === 'number' ? merged.width : DEFAULT_DRAWING_WIDTH,
    height: typeof merged.height === 'number' ? merged.height : DEFAULT_DRAWING_HEIGHT,
    strokes: Array.isArray(merged.strokes) ? merged.strokes : [],
  };
}

export function createDrawingNode(
  schema: EditorState['schema'],
  block: JsonObject,
  blockId: string,
): ReturnType<EditorState['schema']['nodes']['structured_block']['create']> {
  return schema.nodes.structured_block.create({
    blockId,
    blockType: 'drawing',
    payload: drawingPayloadString(block),
  });
}

export function drawingBlockFromAttrs(attrs: Record<string, unknown>): DrawingBlock | null {
  const blockId = typeof attrs.blockId === 'string' ? attrs.blockId : '';
  const payload = parsePayload(attrs.payload);
  if (payload === null) {
    return null;
  }
  return drawingBlockFromPayload(blockId, payload);
}