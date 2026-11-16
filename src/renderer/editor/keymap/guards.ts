import type { EditorState } from 'prosemirror-state';
import { slashMenuState } from '../slash/slash-menu-plugin.js';

function parentIsCodeBlock($pos: EditorState['selection']['$from']): boolean {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.spec.code) {
      return true;
    }
  }
  return $pos.parent.type.spec.code === true;
}

export function typedShortcutsAllowed(state: EditorState): boolean {
  if (slashMenuState(state).open) {
    return false;
  }
  if (parentIsCodeBlock(state.selection.$from)) {
    return false;
  }
  return true;
}
