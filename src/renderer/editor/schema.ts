import { Schema } from 'prosemirror-model';
import type { NodeSpec } from 'prosemirror-model';

// Paragraph text only. Later issues add the other block types and marks.
const nodes: { [name: string]: NodeSpec } = {
  doc: {
    content: 'paragraph+',
  },
  paragraph: {
    content: 'text*',
    group: 'block',
    marks: '',
    parseDOM: [{ tag: 'p' }],
    toDOM() {
      return ['p', 0];
    },
  },
  text: {
    group: 'inline',
  },
};

export const editorSchema: Schema = new Schema({
  nodes,
  marks: {},
});
