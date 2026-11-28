import type { EditorView } from 'prosemirror-view';
import type { ImagePickResult } from '../../../shared/ipc/types.js';
import { requestShellCommand } from '../../editor/editor-command-event.js';
import { runWithSynchronousEditorUpdate } from '../../editor/flush.js';
import { applyPickedImage } from './commands.js';

function readPicker(): (() => Promise<ImagePickResult>) | null {
  const read = globalThis.window?.obelisk?.['image:pick'];
  return typeof read === 'function' ? read : null;
}

export function runImagePick(view: EditorView): void {
  const pick = readPicker();
  if (pick === null) {
    return;
  }
  void pick().then((result) => {
    if (view.isDestroyed) {
      return;
    }
    if (result.status === 'refused') {
      requestShellCommand('image-notice', view.dom.ownerDocument.defaultView, result.message);
      return;
    }
    if (result.status !== 'ok') {
      return;
    }
    runWithSynchronousEditorUpdate(() => {
      view.focus();
      const command = applyPickedImage(result.image);
      command(view.state, view.dispatch.bind(view), view);
    });
  }).catch(() => {
    // A picker failure leaves the document unchanged.
  });
}