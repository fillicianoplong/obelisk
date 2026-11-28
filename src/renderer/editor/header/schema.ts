import { Schema } from 'prosemirror-model';
import { paragraphLayoutAttrs } from '../schema/attrs.js';
import { markSpecs } from '../schema/marks.js';

export const headerSchema = new Schema({
  nodes: {
    doc: {
      content: 'paragraph',
    },
    paragraph: {
      content: '(text | page_field)*',
      attrs: paragraphLayoutAttrs,
      toDOM(node) {
        const {
          align, lineSpacing, spaceBefore, spaceAfter, indentLeft, indentFirst, indentHanging,
        } = node.attrs;
        const attrs: Record<string, string | number> = {
          'data-align': align,
          'data-space-before': spaceBefore,
          'data-space-after': spaceAfter,
          'data-indent-left': indentLeft,
          'data-indent-first': indentFirst,
          'data-indent-hanging': indentHanging,
        };
        if (lineSpacing !== null && lineSpacing !== undefined) {
          attrs['data-line-spacing'] = lineSpacing;
        }
        return ['p', attrs, 0];
      },
    },
    page_field: {
      inline: true,
      atom: true,
      selectable: true,
      attrs: {
        kind: { default: 'page' },
        format: { default: 'decimal' },
      },
      toDOM(node) {
        return ['span', {
          class: 'page-field',
          contenteditable: 'false',
          'data-page-field': node.attrs.kind,
          'data-page-format': node.attrs.format,
        }, '1'];
      },
    },
    text: {
      group: 'inline',
    },
  },
  marks: markSpecs,
});
