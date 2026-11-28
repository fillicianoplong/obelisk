import type { Node as ProseNode } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';

export function blockStartPos(doc: ProseNode, blockIndex: number): number {
  let pos = 0;
  for (let index = 0; index < blockIndex; index += 1) {
    pos += doc.child(index).nodeSize;
  }
  return pos;
}

export function findStructuredBlockIndex(doc: ProseNode, blockType: string, from = 0): number | null {
  for (let index = from; index < doc.childCount; index += 1) {
    const node = doc.child(index);
    if (node.type.name === 'structured_block' && node.attrs.blockType === blockType) {
      return index;
    }
  }
  return null;
}

export function structuredBlockAt(
  state: EditorState,
  blockIndex: number,
): ProseNode | null {
  if (blockIndex < 0 || blockIndex >= state.doc.childCount) {
    return null;
  }
  const node = state.doc.child(blockIndex);
  return node.type.name === 'structured_block' ? node : null;
}