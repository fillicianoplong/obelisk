import type { Command, EditorState } from 'prosemirror-state';
import type { JsonObject } from '../../../shared/ipc/types.js';
import { caretBlockIndex } from '../../editor/block-handle-plugin.js';
import { newBlockId } from '../../editor/block-id.js';
import { parsePayload, stringifyPayload } from '../structured/payload.js';
import { blockStartPos } from '../table/position.js';
import {
  defaultFormulaLatex,
  type FormulaBlockPayload,
  formulaPayloadString,
} from './document.js';

function insertEquationPos(tr: EditorState['tr'], after: number | undefined): number {
  if (after === undefined || after < 0 || after >= tr.doc.childCount) {
    return tr.doc.content.size;
  }
  let pos = 0;
  for (let index = 0; index <= after; index += 1) {
    pos += tr.doc.child(index).nodeSize;
  }
  return pos;
}

export function createEquationNode(
  schema: EditorState['schema'],
  block: JsonObject,
  blockId: string,
): ReturnType<EditorState['schema']['nodes']['structured_block']['create']> {
  return schema.nodes.structured_block.create({
    blockId,
    blockType: 'formula',
    payload: formulaPayloadString({
      type: 'formula',
      id: blockId,
      latex: typeof block.latex === 'string' ? block.latex : defaultFormulaLatex(),
    }),
  });
}

export function insertEquationCommand(): Command {
  return (state, dispatch) => {
    const blockId = newBlockId();
    const latex = defaultFormulaLatex();
    const node = state.schema.nodes.structured_block.create({
      blockId,
      blockType: 'formula',
      payload: stringifyPayload({ latex }),
    });
    const after = caretBlockIndex(state);
    const tr = state.tr.insert(insertEquationPos(state.tr, after), node);
    if (dispatch) {
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export function equationBlockJsonFromAttrs(
  blockId: string,
  attrs: Record<string, unknown>,
): JsonObject {
  const payload = parsePayload(attrs.payload);
  const latex = payload && typeof payload.latex === 'string' ? payload.latex : defaultFormulaLatex();
  return {
    type: 'formula',
    id: blockId,
    latex,
  };
}

export function updateEquationLatexCommand(blockIndex: number, latex: string): Command {
  return (state, dispatch) => {
    const node = state.doc.child(blockIndex);
    if (node.type.name !== 'structured_block' || node.attrs.blockType !== 'formula') {
      return false;
    }
    const pos = blockStartPos(state.doc, blockIndex);
    const payload = stringifyPayload({ latex });
    const tr = state.tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      payload,
    });
    if (dispatch) {
      dispatch(tr);
    }
    return true;
  };
}

export function formulaPayloadEqual(left: FormulaBlockPayload, right: FormulaBlockPayload): boolean {
  return left.latex === right.latex;
}