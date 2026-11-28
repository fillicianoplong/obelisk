import type { Command, EditorState, Transaction } from 'prosemirror-state';
import type { JsonObject } from '../../../shared/ipc/types.js';
import type { SignatureBlock } from '../../../shared/schema/types.js';
import { caretBlockIndex } from '../../editor/block-handle-plugin.js';
import { newBlockId } from '../../editor/block-id.js';
import { requestShellCommand } from '../../editor/editor-command-event.js';
import { stringifyPayload } from '../structured/payload.js';
import {
  activeSignatureStore,
  type StoredSignatureAsset,
} from './assets.js';
import { displayInches } from '../../clipboard/image-bytes.js';
import { blockStartPos } from '../table/position.js';
import {
  DEFAULT_SIGNATURE_WIDTH,
  parseSignaturePayload,
  signaturePayloadFromBlock,
  signaturePayloadString,
} from './document.js';

function insertSignaturePos(tr: Transaction, after: number | undefined): number {
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

function defaultBlock(asset: StoredSignatureAsset): SignatureBlock {
  return {
    type: 'signature',
    id: newBlockId(),
    sha256: asset.sha256,
    line: true,
    width: Math.min(4, Math.max(1.5, displayInches(asset.pixelWidth) || DEFAULT_SIGNATURE_WIDTH)),
    labels: [],
    align: 'left',
    blank: false,
  };
}

export function insertSignatureAssetCommand(asset: StoredSignatureAsset, after?: number): Command {
  const block = defaultBlock(asset);
  const blockId = block.id;
  const payload = stringifyPayload(signaturePayloadFromBlock(block));
  return (state, dispatch) => {
    const node = state.schema.nodes.structured_block.create({
      blockId,
      blockType: 'signature',
      payload,
    });
    const insertAfter = after ?? caretBlockIndex(state);
    const tr = state.tr.insert(insertSignaturePos(state.tr, insertAfter), node);
    if (dispatch) {
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

function replaceSignaturePayload(
  tr: Transaction,
  blockIndex: number,
  block: SignatureBlock,
): Transaction {
  const pos = blockStartPos(tr.doc, blockIndex);
  const node = tr.doc.child(blockIndex);
  if (node.type.name !== 'structured_block' || node.attrs.blockType !== 'signature') {
    return tr;
  }
  const payload = stringifyPayload(signaturePayloadFromBlock(block));
  return tr.setNodeMarkup(pos, undefined, {
    ...node.attrs,
    blockId: block.id,
    blockType: 'signature',
    payload,
  });
}

function withSignatureAt(
  state: EditorState,
  blockIndex: number,
  fn: (block: SignatureBlock) => SignatureBlock | null,
): Transaction | null {
  const node = state.doc.child(blockIndex);
  const block = parseSignaturePayload(node.attrs as Record<string, unknown>);
  if (block === null) {
    return null;
  }
  const next = fn(block);
  if (next === null) {
    return null;
  }
  return replaceSignaturePayload(state.tr, blockIndex, next);
}

export function signatureBlockIndex(state: EditorState): number | null {
  const index = caretBlockIndex(state);
  const node = state.doc.child(index);
  if (node.type.name === 'structured_block' && node.attrs.blockType === 'signature') {
    return index;
  }
  return null;
}

export function signatureMenuCommand(menuId: string): Command | null {
  if (menuId === 'insert-signature' || menuId === 'signature-change') {
    return (_state, _dispatch, view) => {
      if (view) {
        requestShellCommand(
          menuId === 'insert-signature' ? 'insert-signature' : 'signature-change',
          view.dom.ownerDocument.defaultView,
        );
      }
      return true;
    };
  }
  if (menuId === 'signature-edit-labels') {
    return (state, _dispatch, view) => {
      const blockIndex = signatureBlockIndex(state);
      if (blockIndex === null) {
        return false;
      }
      if (view) {
        requestShellCommand('signature-edit-labels', view.dom.ownerDocument.defaultView);
      }
      return true;
    };
  }
  if (menuId === 'signature-blank-mode') {
    return (state, dispatch) => {
      const blockIndex = signatureBlockIndex(state);
      if (blockIndex === null) {
        return false;
      }
      const tr = withSignatureAt(state, blockIndex, (block) => ({ ...block, blank: !block.blank }));
      if (tr === null) {
        return false;
      }
      if (dispatch) {
        dispatch(tr);
      }
      return true;
    };
  }
  if (menuId === 'signature-reset-size') {
    return (state, dispatch) => {
      const blockIndex = signatureBlockIndex(state);
      if (blockIndex === null) {
        return false;
      }
      const tr = withSignatureAt(state, blockIndex, (block) => {
        const asset = activeSignatureStore().get(block.sha256);
        const width = asset ? displayInches(asset.pixelWidth) : DEFAULT_SIGNATURE_WIDTH;
        return { ...block, width };
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
  return null;
}

export function signatureCommandEnabled(state: EditorState, menuId: string): boolean {
  if (menuId === 'insert-signature') {
    return true;
  }
  if (
    menuId === 'signature-change'
    || menuId === 'signature-edit-labels'
    || menuId === 'signature-blank-mode'
    || menuId === 'signature-reset-size'
  ) {
    return signatureBlockIndex(state) !== null;
  }
  return false;
}

export function signatureBlockJsonFromAttrs(
  blockId: string,
  attrs: Record<string, unknown>,
): JsonObject {
  const block = parseSignaturePayload({ ...attrs, blockId });
  if (block === null) {
    return { type: 'signature', id: blockId, sha256: '', line: false, width: DEFAULT_SIGNATURE_WIDTH, labels: [], align: 'left', blank: false };
  }
  return signaturePayloadFromBlock({ ...block, id: blockId }) as JsonObject;
}

export function createSignatureNode(
  schema: EditorState['schema'],
  block: JsonObject,
  blockId: string,
) {
  return schema.nodes.structured_block.create({
    blockId,
    blockType: 'signature',
    payload: signaturePayloadString(block),
  });
}

export function updateSignatureBlock(
  state: EditorState,
  blockIndex: number,
  update: Partial<SignatureBlock>,
): Transaction | null {
  return withSignatureAt(state, blockIndex, (block) => ({ ...block, ...update, type: 'signature', id: block.id }));
}

export function replaceSignatureImage(
  state: EditorState,
  blockIndex: number,
  asset: StoredSignatureAsset,
): Transaction | null {
  return withSignatureAt(state, blockIndex, (block) => ({
    ...block,
    sha256: asset.sha256,
    blank: false,
  }));
}