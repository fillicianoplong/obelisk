import type { NodeSpec } from 'prosemirror-model';
import { headingAttrs } from './attrs.js';

export const headingSpec: NodeSpec = {
  content: 'inline*',
  group: 'block',
  defining: true,
  marks: '',
  attrs: headingAttrs,
  parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
    tag: `h${level}`,
    getAttrs(dom) {
      if (!(dom instanceof HTMLElement)) {
        return false;
      }
      return {
        blockId: dom.dataset.blockId ?? '',
        level,
      };
    },
  })),
  toDOM(node) {
    const level = Math.max(1, Math.min(6, Number(node.attrs.level) || 1));
    return [`h${level}`, { 'data-block-id': node.attrs.blockId, 'data-level': level }, 0];
  },
};
