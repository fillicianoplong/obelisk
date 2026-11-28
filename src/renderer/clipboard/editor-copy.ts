import { Plugin } from 'prosemirror-state';
import type { Command } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import {
  blockHandlePluginKey,
  blockSelectionIsActive,
  emptyBlockHandleState,
} from '../editor/block-handle-plugin.js';
import { activeBlockRange, deleteBlockRange } from '../editor/block-move-commands.js';
import { blocksJsonFromRange } from '../editor/schema/mapping.js';
import { OBELISK_BLOCKS_MIME, serializeObeliskClipboard } from './blocks-json.js';
import { blocksPlainText, blocksRichHtml } from './copy-html.js';

function writeBlockClipboard(data: DataTransfer, view: EditorView, from: number, to: number): boolean {
  const blocks = blocksJsonFromRange(view.state.doc, from, to);
  if (blocks.length === 0) {
    return false;
  }
  const html = blocksRichHtml(blocks);
  const text = blocksPlainText(blocks);
  data.clearData();
  data.setData('text/html', html);
  data.setData('text/plain', text);
  data.setData(OBELISK_BLOCKS_MIME, serializeObeliskClipboard(blocks));
  return true;
}

function deleteBlockSelection(view: EditorView, from: number, to: number): void {
  if (view.state.doc.childCount === 1 && from === 0 && to === 0) {
    return;
  }
  let tr = deleteBlockRange(view.state.tr, from, to);
  if (tr.doc.childCount === 0) {
    return;
  }
  tr = tr.setMeta(blockHandlePluginKey, emptyBlockHandleState());
  view.dispatch(tr.scrollIntoView().setMeta('uiEvent', 'cut'));
}

function handleBlockClipboard(view: EditorView, event: ClipboardEvent, cut: boolean): boolean {
  if (!blockSelectionIsActive(view.state)) {
    return false;
  }
  const { from, to } = activeBlockRange(view.state);
  if (from < 0 || to >= view.state.doc.childCount) {
    return false;
  }
  const data = event.clipboardData;
  if (!data) {
    return false;
  }
  if (!writeBlockClipboard(data, view, from, to)) {
    return false;
  }
  event.preventDefault();
  if (cut) {
    deleteBlockSelection(view, from, to);
  }
  return true;
}

/** Block Cut and Copy from the keyboard. Rich text and Obelisk blocks go on the clipboard. */
export function editorCopyPlugin(): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        copy(view, event) {
          return handleBlockClipboard(view, event, false);
        },
        cut(view, event) {
          return handleBlockClipboard(view, event, true);
        },
      },
    },
  });
}

/** Edit, context, and block menu Cut and Copy. The editor's own handlers write the clipboard. */
export function copyMenuCommand(cut: boolean): Command {
  return (state, dispatch, view) => {
    if (state.selection.empty && !blockSelectionIsActive(state)) {
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