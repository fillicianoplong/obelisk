import type { Command } from 'prosemirror-state';
import { caretBlockIndex } from '../block-handle-plugin.js';
import { insertTextBlock } from '../block-commands.js';
import { newBlockId } from '../block-id.js';

export function insertPageBreakCommand(): Command {
  return (state, dispatch) => {
    const index = caretBlockIndex(state);
    const tr = insertTextBlock(state.tr, 'page-break', newBlockId, { after: index });
    if (dispatch) {
      dispatch(tr);
    }
    return true;
  };
}

export function editorKeysKeymap(): Record<string, Command> {
  return {
    'Mod-Enter': insertPageBreakCommand(),
  };
}
