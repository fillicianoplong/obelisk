import type { NodeSpec } from 'prosemirror-model';

export const inlineSpecs: { [name: string]: NodeSpec } = {
  text: {
    group: 'inline',
  },
  hard_break: {
    inline: true,
    group: 'inline',
    selectable: false,
    parseDOM: [{ tag: 'br' }],
    toDOM() {
      return ['br'];
    },
  },
};
