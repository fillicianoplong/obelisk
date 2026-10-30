import type { NodeSpec } from 'prosemirror-model';
import { blockIdAttr } from './attrs.js';

export const pageBreakSpec: NodeSpec = {
  group: 'block',
  atom: true,
  selectable: true,
  attrs: { blockId: blockIdAttr },
  parseDOM: [{ tag: 'div[data-page-break]', getAttrs(dom) {
    if (!(dom instanceof HTMLElement)) {
      return false;
    }
    return { blockId: dom.dataset.blockId ?? '' };
  } }],
  toDOM(node) {
    return ['div', {
      'data-page-break': 'true',
      'data-block-id': node.attrs.blockId,
      class: 'page-break',
      role: 'separator',
      'aria-label': 'Page break',
    }];
  },
};
