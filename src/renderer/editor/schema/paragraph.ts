import type { NodeSpec } from 'prosemirror-model';
import { paragraphLayoutAttrs } from './attrs.js';

export const paragraphSpec: NodeSpec = {
  content: 'inline*',
  group: 'block',
  marks: '_',
  attrs: paragraphLayoutAttrs,
  parseDOM: [{ tag: 'p', getAttrs(dom) {
    if (!(dom instanceof HTMLElement)) {
      return false;
    }
    const lineSpacingAt = dom.dataset.lineSpacingAt;
    const collapse = dom.dataset.collapseSameStyle;
    return {
      blockId: dom.dataset.blockId ?? '',
      align: dom.dataset.align ?? 'left',
      lineSpacing: dom.dataset.lineSpacing ?? null,
      lineSpacingAt: lineSpacingAt === undefined || lineSpacingAt === '' ? null : Number(lineSpacingAt),
      spaceBefore: Number(dom.dataset.spaceBefore ?? 0),
      spaceAfter: Number(dom.dataset.spaceAfter ?? 0),
      indentLeft: Number(dom.dataset.indentLeft ?? 0),
      indentRight: Number(dom.dataset.indentRight ?? 0),
      indentFirst: Number(dom.dataset.indentFirst ?? 0),
      indentHanging: Number(dom.dataset.indentHanging ?? 0),
      dontAddSpaceBetweenSameStyle: collapse === 'true' ? true : collapse === 'false' ? false : null,
    };
  } }],
  toDOM(node) {
    const {
      blockId, align, lineSpacing, lineSpacingAt, spaceBefore, spaceAfter,
      indentLeft, indentRight, indentFirst, indentHanging, dontAddSpaceBetweenSameStyle,
    } = node.attrs;
    const attrs: Record<string, string | number> = {
      'data-block-id': blockId,
      'data-align': align,
      'data-space-before': spaceBefore,
      'data-space-after': spaceAfter,
      'data-indent-left': indentLeft,
      'data-indent-right': indentRight,
      'data-indent-first': indentFirst,
      'data-indent-hanging': indentHanging,
    };
    if (lineSpacing !== null && lineSpacing !== undefined) {
      attrs['data-line-spacing'] = lineSpacing;
    }
    if (lineSpacingAt !== null && lineSpacingAt !== undefined && Number.isFinite(lineSpacingAt)) {
      attrs['data-line-spacing-at'] = lineSpacingAt;
    }
    if (dontAddSpaceBetweenSameStyle === true) {
      attrs['data-collapse-same-style'] = 'true';
    } else if (dontAddSpaceBetweenSameStyle === false) {
      attrs['data-collapse-same-style'] = 'false';
    }
    return ['p', attrs, 0];
  },
};
