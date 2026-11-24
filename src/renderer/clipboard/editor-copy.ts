import type { Command } from 'prosemirror-state';

/** Edit, context, and block menu Cut and Copy. The editor's own handlers write the clipboard. */
export function copyMenuCommand(cut: boolean): Command {
  return (state, dispatch, view) => {
    if (state.selection.empty) {
      return false;
    }
    if (!dispatch || !view) {
      return true;
    }
    view.focus();
    try {
      view.dom.ownerDocument.execCommand(cut ? 'cut' : 'copy');
    } catch {
      // The editor's cut and copy handlers own the clipboard.
    }
    return true;
  };
}
