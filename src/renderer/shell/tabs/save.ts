import type { EditorState } from 'prosemirror-state';
import type { DocumentMessage, FileSaveAsRequest, FileSaveRequest, FileStat } from '../../../shared/ipc/types.js';
import { isAutosavePaused } from '../../autosave/model.js';
import type { SaveState } from '../statusbar/model.js';
import { saveStateFromChanged } from '../statusbar/model.js';
import { documentFromEditor } from './document.js';
import { replaceTabEditor, tabHasUnsavedChanges } from './model.js';
import type { PageTab } from './model.js';

// FR-13. The wording is the choice the SRS names: Overwrite, Save as, or Cancel.
export const CONFLICT_MESSAGE = 'Another program changed this file.';

export const CONFLICT_TITLE = 'Save';

export const CONFLICT_CHOICES = [
  { choice: 'overwrite', label: 'Overwrite' },
  { choice: 'save-as', label: 'Save as…' },
  { choice: 'cancel', label: 'Cancel' },
] as const;

export type ConflictChoice = (typeof CONFLICT_CHOICES)[number]['choice'];

export const EXISTS_MESSAGE = 'A file with that name exists, so it was not saved.';

export const TIMEOUT_MESSAGE = 'The save did not finish within 5 seconds, so it was not saved.';

export function noteEditorChange(tab: PageTab, editor: EditorState): PageTab {
  if (tab.editor.doc.eq(editor.doc)) {
    return replaceTabEditor(tab, editor);
  }
  const replaced = replaceTabEditor(tab, editor);
  return { ...replaced, revision: tab.revision + 1 };
}

export function documentForTab(tab: PageTab): { document: DocumentMessage; blockIds: string[] } {
  return documentFromEditor(tab.baseDocument, tab.editor.doc);
}

export function saveRequest(tab: PageTab, document: DocumentMessage, expectedStat: FileStat | null, replaceConfirmed: boolean): FileSaveRequest | null {
  if (!tab.handle) {
    return null;
  }
  return {
    handle: tab.handle,
    document,
    revision: tab.revision,
    expectedStat,
    replaceConfirmed,
  };
}

export function saveAsRequest(tab: PageTab, document: DocumentMessage): FileSaveAsRequest {
  return {
    handle: tab.handle ?? null,
    document,
    revision: tab.revision,
  };
}

export function markSaving(tab: PageTab): PageTab {
  return { ...tab, savePhase: 'saving' };
}

export function markSaveFailed(tab: PageTab): PageTab {
  return { ...tab, savePhase: 'not-saved' };
}

export function markSaveIdle(tab: PageTab): PageTab {
  if (tab.savePhase !== 'saving') {
    return tab;
  }
  return { ...tab, savePhase: null };
}

export interface SavedTabInput {
  revision: number;
  stat: FileStat;
  document: DocumentMessage;
  blockIds: string[];
  handle?: string;
  name?: string;
}

// The unsaved mark clears only after a finished save, and only when the tab
// was not edited again while that save was in flight (NFR-12).
export function applySavedTab(tab: PageTab, saved: SavedTabInput): PageTab {
  const caughtUp = saved.revision === tab.revision;
  return {
    ...tab,
    handle: saved.handle ?? tab.handle,
    title: saved.name ?? tab.title,
    stat: saved.stat,
    savePhase: null,
    autosavePaused: caughtUp ? false : tab.autosavePaused,
    baseDocument: caughtUp ? saved.document : tab.baseDocument,
    blockIds: caughtUp ? saved.blockIds : tab.blockIds,
    savedDoc: caughtUp ? tab.editor.doc : tab.savedDoc,
  };
}

export function tabSaveState(tab: PageTab): SaveState {
  if (tab.kind === 'settings') {
    return 'saved';
  }
  if (tab.savePhase === 'saving') {
    return 'saving';
  }
  if (tab.savePhase === 'not-saved') {
    return 'not-saved';
  }
  if (isAutosavePaused(tab)) {
    return 'autosave-paused';
  }
  return saveStateFromChanged(tabHasUnsavedChanges(tab));
}

export function tabStaysChanged(tab: PageTab): boolean {
  return tabHasUnsavedChanges(tab);
}

export interface SessionHandles {
  handles: string[];
  activeHandle: string | null;
}

export function sessionHandles(tabs: readonly Pick<PageTab, 'id' | 'handle'>[], activeId: string): SessionHandles {
  const handles: string[] = [];
  let activeHandle: string | null = null;
  for (const tab of tabs) {
    if (!tab.handle) {
      continue;
    }
    handles.push(tab.handle);
    if (tab.id === activeId) {
      activeHandle = tab.handle;
    }
  }
  return { handles, activeHandle };
}
