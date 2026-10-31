import type { EditorState } from 'prosemirror-state';
import type { DocumentMessage, FileOpenResult, FileStat } from '../../../shared/ipc/types.js';
import { editorDocFromDocument, blockIdsFromDocument } from '../../editor/schema/mapping.js';
import { createTabEditorState } from '../../editor/state.js';
import { isReplaceableUntitledTab, type PageTab } from './model.js';

export function editorFromDocument(document: DocumentMessage): EditorState {
  const doc = editorDocFromDocument(document);
  return createTabEditorState(doc);
}

export function createOpenedTab(opened: {
  handle: string;
  name: string;
  document: DocumentMessage;
  stat: FileStat;
}): PageTab {
  const editor = editorFromDocument(opened.document);
  return {
    id: opened.handle,
    title: opened.name,
    handle: opened.handle,
    editor,
    savedDoc: editor.doc,
    revision: 0,
    stat: opened.stat,
    savePhase: null,
    baseDocument: opened.document,
    blockIds: blockIdsFromDocument(opened.document),
  };
}

export interface OpenApply {
  tabs: PageTab[];
  activeId: string;
  message: string | null;
}

export function applyOpenResult(
  tabs: readonly PageTab[],
  activeId: string,
  result: FileOpenResult,
): OpenApply {
  if (result.status === 'cancelled') {
    return { tabs: tabs as PageTab[], activeId, message: null };
  }
  if (result.status === 'ok') {
    const existing = tabs.find((tab) => tab.id === result.handle || tab.handle === result.handle);
    if (existing) {
      const nextActive = existing.id;
      return {
        tabs: withoutLoneReplaceableUntitled(tabs, nextActive),
        activeId: nextActive,
        message: null,
      };
    }
    const tab = createOpenedTab(result);
    if (tabs.length === 0 || (tabs.length === 1 && isReplaceableUntitledTab(tabs[0]))) {
      return { tabs: [tab], activeId: tab.id, message: null };
    }
    const merged = [...tabs, tab];
    return {
      tabs: withoutLoneReplaceableUntitled(merged, tab.id),
      activeId: tab.id,
      message: null,
    };
  }
  if (result.status === 'alreadyOpen') {
    const existing = tabs.find((tab) => tab.id === result.tabId || tab.handle === result.tabId);
    if (!existing) {
      return {
        tabs: tabs as PageTab[],
        activeId,
        message: 'That file is already open, and its tab is not in this window.',
      };
    }
    return {
      tabs: withoutLoneReplaceableUntitled(tabs, existing.id),
      activeId: existing.id,
      message: null,
    };
  }
  if (result.status === 'refused' || result.status === 'error') {
    return { tabs: tabs as PageTab[], activeId, message: result.message };
  }
  return { tabs: tabs as PageTab[], activeId, message: 'This file could not be opened.' };
}

function withoutLoneReplaceableUntitled(tabs: readonly PageTab[], activeId: string): PageTab[] {
  const active = tabs.find((tab) => tab.id === activeId);
  if (active === undefined || isReplaceableUntitledTab(active)) {
    return tabs as PageTab[];
  }
  if (!tabs.some(isReplaceableUntitledTab)) {
    return tabs as PageTab[];
  }
  return tabs.filter((tab) => !isReplaceableUntitledTab(tab)) as PageTab[];
}
