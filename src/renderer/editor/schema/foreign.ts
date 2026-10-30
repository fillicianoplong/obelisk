import type { NodeSpec } from 'prosemirror-model';
import { foreignBlockAttrs } from './attrs.js';

export const foreignBlockSpec: NodeSpec = {
  group: 'block',
  atom: true,
  selectable: true,
  attrs: foreignBlockAttrs,
  toDOM(node) {
    return ['div', {
      class: 'foreign-block',
      'data-foreign-block': 'true',
      'data-block-id': node.attrs.blockId,
      'data-block-type': node.attrs.blockType,
      contenteditable: 'false',
    }, node.attrs.blockType];
  },
};
