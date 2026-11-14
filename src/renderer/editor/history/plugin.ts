import { history } from 'prosemirror-history';
import { EDITOR_HISTORY_NEW_GROUP_DELAY_MS, EDITOR_UNDO_DEPTH } from './constants.js';
import { historyGroupingPlugin } from './groups.js';

export function editorHistoryPlugins() {
  return [
    history({ depth: EDITOR_UNDO_DEPTH, newGroupDelay: EDITOR_HISTORY_NEW_GROUP_DELAY_MS }),
    historyGroupingPlugin(),
  ];
}