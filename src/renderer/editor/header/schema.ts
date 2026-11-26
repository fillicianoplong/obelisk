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
        return ['p', {
          'data-align': node.attrs.align,
          'data-line-spacing': node.attrs.lineSpacing,
          'data-space-before': node.attrs.spaceBefore,
          'data-space-after': node.attrs.spaceAfter,
          'data-indent-left': node.attrs.indentLeft,
          'data-indent-first': node.attrs.indentFirst,
          'data-indent-hanging': node.attrs.indentHanging,
        }, 0];
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
