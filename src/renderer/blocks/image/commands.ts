import type { Command, EditorState, Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { ImageBlock } from '../../../shared/schema/types.js';
import { caretBlockIndex } from '../../editor/block-handle-plugin.js';
import { newBlockId } from '../../editor/block-id.js';
import { stringifyPayload } from '../structured/payload.js';
import {
  activeImageStore,
  assetFromPicked,
  assetFromRawBytes,
  defaultImageWidth,
  type StoredImageAsset,
} from './assets.js';
import { imagePayloadFromBlock, imagePayloadString } from './document.js';
import { runImagePick } from './pick.js';

function insertImagePos(tr: Transaction, after: number | undefined): number {
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

export function insertImageAssetCommand(asset: StoredImageAsset, after?: number): Command {
  const block: ImageBlock = {
    type: 'image',
    id: newBlockId(),
    sha256: asset.sha256,
    width: defaultImageWidth(asset.pixelWidth),
    rotation: 0,
    flipHorizontal: false,
    flipVertical: false,
    alt: '',
  };
  const blockId = block.id;
  const payload = stringifyPayload(imagePayloadFromBlock(block as never));
  const nodeType = (state: EditorState) => state.schema.nodes.structured_block.create({
    blockId,
    blockType: 'image',
    payload,
  });
  return (state, dispatch) => {
    const node = nodeType(state);
    const insertAfter = after ?? caretBlockIndex(state);
    const tr = state.tr.insert(insertImagePos(state.tr, insertAfter), node);
    if (dispatch) {
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export function applyPickedImage(image: {
  sha256: string;
  type: 'png' | 'jpeg' | 'gif' | 'webp';
  data: string;
  pixelWidth: number;
  pixelHeight: number;
  frames: number;
}): Command {
  const asset = assetFromPicked(image);
  activeImageStore().put(asset);
  return insertImageAssetCommand(asset);
}

export async function insertPastedImageBytes(
  view: EditorView,
  bytes: Uint8Array,
  afterBlockIndex: number | null,
): Promise<boolean> {
  const asset = await assetFromRawBytes(bytes);
  if (asset === null) {
    return false;
  }
  activeImageStore().put(asset);
  const command = insertImageAssetCommand(asset, afterBlockIndex ?? undefined);
  return command(view.state, view.dispatch.bind(view), view);
}

export function imageMenuCommand(menuId: string): Command | null {
  if (menuId !== 'insert-image') {
    return null;
  }
  return (_state, _dispatch, view) => {
    if (!view) {
      return true;
    }
    runImagePick(view);
    return true;
  };
}

export function imageCommandEnabled(_state: EditorState, menuId: string): boolean {
  return menuId === 'insert-image';
}

export function imageBlockJsonFromAttrs(
  blockId: string,
  attrs: Record<string, unknown>,
): import('../../../shared/ipc/types.js').JsonObject {
  const payload = attrs.payload;
  let merged: Record<string, unknown> = {};
  if (typeof payload === 'string' && payload.length > 0) {
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') {
        merged = parsed;
      }
    } catch {
      merged = {};
    }
  }
  const rotation = merged.rotation;
  const normalizedRotation = rotation === 90 || rotation === 180 || rotation === 270 ? rotation : 0;
  return {
    type: 'image',
    id: blockId,
    sha256: typeof merged.sha256 === 'string' ? merged.sha256 : '',
    width: typeof merged.width === 'number' ? merged.width : 1,
    rotation: normalizedRotation,
    flipHorizontal: merged.flipHorizontal === true,
    flipVertical: merged.flipVertical === true,
    alt: typeof merged.alt === 'string' ? merged.alt : '',
  };
}

export function createImageNode(
  schema: EditorState['schema'],
  block: import('../../../shared/ipc/types.js').JsonObject,
  blockId: string,
) {
  return schema.nodes.structured_block.create({
    blockId,
    blockType: 'image',
    payload: imagePayloadString(block),
  });
}