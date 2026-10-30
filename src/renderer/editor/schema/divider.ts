import type { NodeSpec } from 'prosemirror-model';
import { blockIdAttr } from './attrs.js';

export const dividerSpec: NodeSpec = {
  group: 'block',
  atom: true,
  selectable: true,
  attrs: { blockId: blockIdAttr },
  parseDOM: [{ tag: 'hr[data-divider]', getAttrs(dom) {
    if (!(dom instanceof HTMLElement)) {
      return false;
    }
    return { blockId: dom.dataset.blockId ?? '' };
  } }],
  toDOM(node) {
    return ['hr', { 'data-divider': 'true', 'data-block-id': node.attrs.blockId }];
  },
};
