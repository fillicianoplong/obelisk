import { chainCommands } from 'prosemirror-commands';
import { redo, undo } from 'prosemirror-history';
import { undoInputRule } from 'prosemirror-inputrules';

export function editorHistoryKeymap() {
  return {
    'Mod-z': chainCommands(undoInputRule, undo),
    'Mod-y': redo,
    'Shift-Mod-z': redo,
  };
}