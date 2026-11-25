import type { Command } from 'prosemirror-state';
import { caretBlockIndex } from '../block-handle-plugin.js';
import { insertTextBlock } from '../block-commands.js';
import { newBlockId } from '../block-id.js';

/** Backspace at the start of the block after a page break removes the break. */
export function backspacePageBreak(): Command {
  return (state, dispatch) => {
    const { selection } = state;
    if (!selection.empty) {
      return false;
    }
    const { $from } = selection;
    if ($from.depth !== 1 || $from.parentOffset !== 0) {
      return false;
    }
    const index = $from.index(0);
    if (index <= 0) {
      return false;
    }
    const previous = state.doc.child(index - 1);
    if (previous.type.name !== 'page_break') {
      return false;
    }
    const at = $from.before(1);
    if (dispatch) {
      dispatch(state.tr.delete(at - previous.nodeSize, at));
    }
    return true;
  };
}

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
