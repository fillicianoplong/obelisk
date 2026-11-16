import type { Command } from 'prosemirror-state';
import { editorSchema } from '../schema/index.js';
import { markCloseHistoryGroup } from './history-groups.js';

const SOFT_BREAK_PARENTS = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'list_item',
  'checklist_item',
]);

import type { ResolvedPos } from 'prosemirror-model';

function parentIsCodeBlock($pos: ResolvedPos): boolean {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.spec.code) {
      return true;
    }
  }
  return $pos.parent.type.spec.code === true;
}

export function softBreakCommand(): Command {
  return (state, dispatch) => {
    const { $from } = state.selection;
    if (parentIsCodeBlock($from)) {
      return false;
    }
    if (!SOFT_BREAK_PARENTS.has($from.parent.type.name)) {
      return false;
    }
    if (dispatch) {
      const tr = markCloseHistoryGroup(
        state.tr.replaceSelectionWith(editorSchema.nodes.hard_break.create()).scrollIntoView(),
      );
      dispatch(tr);
    }
    return true;
  };
}

export function softBreakKeymap(): Record<string, Command> {
  return {
    'Shift-Enter': softBreakCommand(),
  };
}
