import type { NodeSpec } from 'prosemirror-model';
import { blockIdAttr } from '../../editor/schema/attrs.js';

export const STRUCTURED_BLOCK_TYPES = new Set(['table']);

export const structuredBlockAttrs = {
  blockId: blockIdAttr,
  blockType: { default: 'unknown' },
  payload: { default: '' },
};

export const structuredBlockSpec: NodeSpec = {
  group: 'block',
  atom: true,
  selectable: true,
  attrs: structuredBlockAttrs,
  toDOM(node) {
    return [
      'div',
      {
        class: 'structured-block',
        'data-structured-block': 'true',
        'data-block-id': node.attrs.blockId,
        'data-block-type': node.attrs.blockType,
        contenteditable: 'false',
      },
    ];
  },
  parseDOM: [{
    tag: 'div[data-structured-block]',
    getAttrs(dom) {
      if (!(dom instanceof HTMLElement)) {
        return false;
      }
      return {
        blockId: dom.getAttribute('data-block-id') ?? '',
        blockType: dom.getAttribute('data-block-type') ?? 'unknown',
        payload: dom.getAttribute('data-payload') ?? '',
      };
    },
  }],
};