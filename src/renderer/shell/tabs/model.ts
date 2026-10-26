import type { Node } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import { createTabEditorState } from '../../editor/state.js';

export const UNSAVED_CHANGES_NAME = 'Unsaved changes';

export interface PageTab {
  id: string;
  title: string;
  /** Present once the document has a saved path. A never-saved tab omits it. */
  path?: string;
  editor: EditorState;
  /** The document at the last save, or the empty document for a new tab. */
  savedDoc: Node;
}

export function untitledTitle(number: number): string {
  return `Untitled ${number}`;
}

export function createTab(number: number): PageTab {
  const editor = createTabEditorState();
  return {
    id: `untitled-${number}`,
    title: untitledTitle(number),
    editor,
    savedDoc: editor.doc,
  };
}

export function tabHasUnsavedChanges(tab: PageTab): boolean {
  return !tab.editor.doc.eq(tab.savedDoc);
}

export function tabAccessibleName(tab: PageTab): string {
  if (tabHasUnsavedChanges(tab)) {
    return `${tab.title}, ${UNSAVED_CHANGES_NAME}`;
  }
  return tab.title;
}

export function tabTooltip(tab: Pick<PageTab, 'title' | 'path'>): string {
  if (tab.path !== undefined && tab.path.length > 0) {
    return `${tab.title} — ${tab.path}`;
  }
  return tab.title;
}

export function replaceTabEditor(tab: PageTab, editor: EditorState): PageTab {
  if (tab.editor === editor) {
    return tab;
  }
  return { ...tab, editor };
}
