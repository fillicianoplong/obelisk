import type { NodeSpec } from 'prosemirror-model';

export const inlineSpecs: { [name: string]: NodeSpec } = {
  text: {
    group: 'inline',
  },
};
