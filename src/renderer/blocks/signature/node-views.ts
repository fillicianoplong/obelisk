import type { Node as ProseNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import { tableNodeViews } from '../table/view.js';
import { SignatureBlockView } from './view.js';

export function structuredNodeViews(): Record<string, (node: ProseNode, view: EditorView, getPos: () => number | undefined) => NodeView> {
  const table = tableNodeViews();
  return {
    structured_block(node, view, getPos) {
      if (node.attrs.blockType === 'signature') {
        return new SignatureBlockView(node, view);
      }
      return table.structured_block(node, view, getPos);
    },
  };
}