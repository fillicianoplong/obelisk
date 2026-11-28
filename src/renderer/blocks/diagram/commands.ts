import type { Command, EditorState } from 'prosemirror-state';
import type { JsonObject } from '../../../shared/ipc/types.js';
import { blockPosAtIndex, caretBlockIndex } from '../../editor/block-handle-plugin.js';
import { newBlockId } from '../../editor/block-id.js';
import { parsePayload, stringifyPayload } from '../structured/payload.js';
import {
  defaultDiagramSource,
  type DiagramBlockPayload,
  diagramPayloadString,
} from './document.js';

function insertDiagramPos(tr: EditorState['tr'], after: number | undefined): number {
  if (after === undefined || after < 0 || after >= tr.doc.childCount) {
    return tr.doc.content.size;
  }
  let pos = 0;
  for (let index = 0; index <= after; index += 1) {
    pos += tr.doc.child(index).nodeSize;
  }
  return pos;
}

export function createDiagramNode(
  schema: EditorState['schema'],
  block: JsonObject,
  blockId: string,
): ReturnType<EditorState['schema']['nodes']['structured_block']['create']> {
  return schema.nodes.structured_block.create({
    blockId,
    blockType: 'diagram',
    payload: diagramPayloadString({
      type: 'diagram',
      id: blockId,
      source: typeof block.source === 'string' ? block.source : defaultDiagramSource(),
    }),
  });
}

export function insertDiagramCommand(): Command {
  return (state, dispatch) => {
    const blockId = newBlockId();
    const node = state.schema.nodes.structured_block.create({
      blockId,
      blockType: 'diagram',
      payload: stringifyPayload({ source: defaultDiagramSource() }),
    });
    const index = caretBlockIndex(state);
    const current = state.doc.child(index);
    let tr = state.tr;
    if (current.type.name === 'paragraph' && current.content.size === 0) {
      const from = blockPosAtIndex(state.doc, index);
      tr = tr.replaceWith(from, from + current.nodeSize, node);
    } else {
      tr = tr.insert(insertDiagramPos(tr, index), node);
    }
    if (dispatch) {
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export function diagramBlockJsonFromAttrs(
  blockId: string,
  attrs: Record<string, unknown>,
): JsonObject {
  const payload = parsePayload(attrs.payload);
  const source = payload && typeof payload.source === 'string' ? payload.source : defaultDiagramSource();
  return {
    type: 'diagram',
    id: blockId,
    source,
  };
}

export function diagramPayloadEqual(left: DiagramBlockPayload, right: DiagramBlockPayload): boolean {
  return left.source === right.source;
}