import { Plugin } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import {
  selectedBlockRange,
  selectBlockByIndex,
  textSelectionForEditorPointer,
  textSelectionFromDocumentCoords,
} from '../../editor/block-handle-plugin.js';
import { resetPageFocusToPointer } from '../page-focus.js';
import {
  CONTEXT_MENU_RESTORE_FOCUS,
  dispatchContextMenuRequest,
  type ContextMenuRestoreDetail,
} from './events.js';
import { proseBlockType, resolveContextTarget } from './target.js';

function anchorFromKeyboard(view: EditorView): { x: number; y: number } {
  try {
    const head = view.coordsAtPos(view.state.selection.head);
    return { x: head.left, y: head.bottom };
  } catch {
    const rect = view.dom.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + 48 };
  }
}

function restoreEditorAfterContextMenu(view: EditorView, detail: ContextMenuRestoreDetail): void {
  const { doc } = view.state;
  const anchor = Math.max(0, Math.min(detail.selectionAnchor, doc.content.size));
  const head = Math.max(0, Math.min(detail.selectionHead, doc.content.size));
  view.dispatch(view.state.tr.setSelection(textSelectionFromDocumentCoords(doc, anchor, head)));
  const active = view.dom.ownerDocument.activeElement;
  if (active instanceof HTMLElement && active !== view.dom && !view.dom.contains(active)) {
    active.blur();
  }
  resetPageFocusToPointer(view.dom);
  view.focus();
  resetPageFocusToPointer(view.dom);
  queueMicrotask(() => {
    resetPageFocusToPointer(view.dom);
  });
  view.dom.ownerDocument.defaultView?.requestAnimationFrame(() => {
    if (!view.isDestroyed) {
      resetPageFocusToPointer(view.dom);
    }
  });
}

export function contextMenuEditorPlugin(tabId: string) {
  return new Plugin({
    view(view) {
      function onRestore(event: Event) {
        if (!(event instanceof CustomEvent)) {
          return;
        }
        const detail = event.detail as ContextMenuRestoreDetail;
        if (detail.tabId !== tabId) {
          return;
        }
        restoreEditorAfterContextMenu(view, detail);
      }
      function onHandleContextMenu(event: MouseEvent) {
        if (!(event.target instanceof HTMLElement)) {
          return;
        }
        const handle = event.target.closest('.block-handle');
        if (handle === null) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const blockIndex = Number(handle.getAttribute('data-block-index'));
        if (!Number.isInteger(blockIndex)) {
          return;
        }
        const tr = selectBlockByIndex(view.state, blockIndex, false);
        if (tr !== null) {
          view.dispatch(tr);
        }
        const node = view.state.doc.child(blockIndex);
        const rect = handle.getBoundingClientRect();
        const selection = { selectionAnchor: view.state.selection.anchor, selectionHead: view.state.selection.head };
        dispatchContextMenuRequest({
          tabId,
          kind: 'block',
          blockType: proseBlockType(node),
          blockIndex,
          clientX: rect.right,
          clientY: rect.top + rect.height / 2,
          keyboard: false,
          ...selection,
        });
      }
      view.dom.ownerDocument.addEventListener('contextmenu', onHandleContextMenu, true);
      function openContextMenuAtPointer(
        clientX: number,
        clientY: number,
        domTarget: EventTarget | null,
      ): void {
        try {
          const target = resolveContextTarget(view, clientX, clientY, domTarget, false);
          dispatchContextMenuRequest({ tabId, ...target });
        } catch {
          // Keep the editor alive if targeting fails for an odd hit target.
        }
      }
      function onPageRegionContextMenu(event: Event) {
        if (!(event instanceof MouseEvent)) {
          return;
        }
        if (!(event.target instanceof Node) || view.dom.contains(event.target)) {
          return;
        }
        const region = view.dom.closest('.page-region');
        if (!(region instanceof HTMLElement) || !region.contains(event.target)) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (selectedBlockRange(view.state) === null) {
          view.dispatch(textSelectionForEditorPointer(view, event));
        }
        openContextMenuAtPointer(event.clientX, event.clientY, event.target);
      }
      const pageRegion = view.dom.closest('.page-region');
      pageRegion?.addEventListener('contextmenu', onPageRegionContextMenu, true);
      window.addEventListener(CONTEXT_MENU_RESTORE_FOCUS, onRestore);
      return {
        destroy() {
          view.dom.ownerDocument.removeEventListener('contextmenu', onHandleContextMenu, true);
          pageRegion?.removeEventListener('contextmenu', onPageRegionContextMenu, true);
          window.removeEventListener(CONTEXT_MENU_RESTORE_FOCUS, onRestore);
        },
      };
    },
    props: {
      handleDOMEvents: {
        contextmenu(view, event) {
          event.preventDefault();
          if (selectedBlockRange(view.state) === null) {
            try {
              view.dispatch(textSelectionForEditorPointer(view, event));
            } catch {
              // Selection at block edges can fail; still open a context target.
            }
          }
          try {
            const target = resolveContextTarget(view, event.clientX, event.clientY, event.target, false);
            dispatchContextMenuRequest({ tabId, ...target });
          } catch {
            // Ignore bad hit targets so the renderer does not crash.
          }
          return true;
        },
      },
      handleKeyDown(view, event) {
        const isShiftF10 = event.key === 'F10' && event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
        const isMenuKey = event.key === 'ContextMenu' || event.code === 'ContextMenu';
        if (!isShiftF10 && !isMenuKey) {
          return false;
        }
        event.preventDefault();
        const anchor = anchorFromKeyboard(view);
        const target = resolveContextTarget(view, anchor.x, anchor.y, null, true);
        dispatchContextMenuRequest({ tabId, ...target });
        return true;
      },
    },
  });
}