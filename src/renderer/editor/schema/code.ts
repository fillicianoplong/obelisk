import type { NodeSpec } from 'prosemirror-model';
import { blockIdAttr } from './attrs.js';

export const codeBlockSpec: NodeSpec = {
  content: 'text*',
  marks: '',
  group: 'block',
  code: true,
  defining: true,
  attrs: { blockId: blockIdAttr },
  parseDOM: [{ tag: 'pre[data-code-block]', getAttrs(dom) {
    if (!(dom instanceof HTMLElement)) {
      return false;
    }
    return { blockId: dom.dataset.blockId ?? '' };
  } }],
  toDOM(node) {
    return ['pre', { 'data-code-block': 'true', 'data-block-id': node.attrs.blockId }, ['code', 0]];
  },
};
