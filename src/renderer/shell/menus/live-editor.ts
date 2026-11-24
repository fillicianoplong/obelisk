import { NodeSelection, TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { LiveMenuContext } from './apply.js';

type EditorPage = HTMLElement & { editorView?: EditorView };

export function pageEditorView(): EditorView | null {
  const page = document.querySelector('[data-region="page-editor"]');
  if (!(page instanceof HTMLElement)) {
    return null;
  }
  const view = (page as EditorPage).editorView;
  if (view === undefined || view.isDestroyed) {
    return null;
  }
  return view;
}

function selectionFromEditorDom(view: EditorView): TextSelection | null {
  const domSelection = view.dom.ownerDocument.getSelection();
  if (domSelection === null || domSelection.rangeCount === 0 || domSelection.isCollapsed) {
    return null;
  }
  const { anchorNode, focusNode } = domSelection;
  if (anchorNode === null || focusNode === null) {
    return null;
  }
  if (!view.dom.contains(anchorNode) || !view.dom.contains(focusNode)) {
    return null;
  }
  try {
    const anchor = view.posAtDOM(anchorNode, domSelection.anchorOffset);
    const head = view.posAtDOM(focusNode, domSelection.focusOffset);
    return TextSelection.create(view.state.doc, anchor, head);
  } catch {
    return null;
  }
}

/**
 * A double-click or drag can select text in the page before the editor records it.
 * Copy that range in so Cut and Copy see it when the menu opens.
 */
export function noteLiveSelection(): void {
  const view = pageEditorView();
  if (view === null || view.composing || view.state.selection instanceof NodeSelection) {
    return;
  }
  const live = selectionFromEditorDom(view);
  if (live === null || live.eq(view.state.selection)) {
    return;
  }
  view.dispatch(view.state.tr.setSelection(live).setMeta('addToHistory', false));
}

/** Menu enablement uses the editor's current selection, not an earlier React snapshot. */
export function withLiveEditor(context: LiveMenuContext): LiveMenuContext {
  const view = pageEditorView();
  if (view === null) {
    return context;
  }
  return {
    ...context,
    editorState: view.state,
    selectionEmpty: view.state.selection.empty,
  };
}
