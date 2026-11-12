import type { NodeSpec } from 'prosemirror-model';
import { paragraphLayoutAttrs } from './attrs.js';

export const paragraphSpec: NodeSpec = {
  content: 'inline*',
  group: 'block',
  marks: '',
  attrs: paragraphLayoutAttrs,
  parseDOM: [{ tag: 'p', getAttrs(dom) {
    if (!(dom instanceof HTMLElement)) {
      return false;
    }
    return {
      blockId: dom.dataset.blockId ?? '',
      align: dom.dataset.align ?? 'left',
      lineSpacing: dom.dataset.lineSpacing ?? 'single',
      spaceBefore: Number(dom.dataset.spaceBefore ?? 0),
      spaceAfter: Number(dom.dataset.spaceAfter ?? 0),
      indentLeft: Number(dom.dataset.indentLeft ?? 0),
      indentFirst: Number(dom.dataset.indentFirst ?? 0),
      indentHanging: Number(dom.dataset.indentHanging ?? 0),
    };
  } }],
  toDOM(node) {
    const {
      blockId, align, lineSpacing, spaceBefore, spaceAfter,
      indentLeft, indentFirst, indentHanging,
    } = node.attrs;
    return ['p', {
      'data-block-id': blockId,
      'data-align': align,
      'data-line-spacing': lineSpacing,
      'data-space-before': spaceBefore,
      'data-space-after': spaceAfter,
      'data-indent-left': indentLeft,
      'data-indent-first': indentFirst,
      'data-indent-hanging': indentHanging,
    }, 0];
  },
};
