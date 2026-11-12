import type { NodeSpec } from 'prosemirror-model';
import { blockIdAttr } from './attrs.js';

export const quoteSpec: NodeSpec = {
  content: 'inline*',
  group: 'block',
  marks: '',
  attrs: { blockId: blockIdAttr },
  parseDOM: [{ tag: 'blockquote', getAttrs(dom) {
    if (!(dom instanceof HTMLElement)) {
      return false;
    }
    return { blockId: dom.dataset.blockId ?? '' };
  } }],
  toDOM(node) {
    return ['blockquote', { 'data-block-id': node.attrs.blockId }, 0];
  },
};
