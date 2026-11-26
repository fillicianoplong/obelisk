import type { Node } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import type { DocumentMessage, DocumentView, FileStat, JsonObject } from '../../../shared/ipc/types.js';
import {
  defaultPageSetup,
  pageSetupFromUnknown,
  samePageSetup,
  type PageSetupValue,
} from '../page-setup/model.js';
import { createTabEditorState } from '../../editor/state.js';
import { editorDocFromDocument } from '../../editor/schema/mapping.js';
import { createBaseDocument } from './document.js';

export const UNSAVED_CHANGES_NAME = 'Unsaved changes';

export const SETTINGS_TAB_ID = 'settings';

export type SavePhase = 'saving' | 'not-saved' | null;

export interface PageTab {
  id: string;
  title: string;
  /** Not set by Open or Save. The renderer does not keep a real path. */
  path?: string;
  /** Opaque id main issued for this file. A new tab omits it. */
  handle?: string;
  /** A document tab omits this. Settings is the Tools > Settings tab. */
  kind?: 'document' | 'settings';
  editor: EditorState;
  /** The document at the last save, or the empty document for a new tab. */
  savedDoc: Node;
  /** Increments when the editor document changes. Save echoes the value it wrote. */
  revision: number;
  /** Stat main recorded at open or the last successful save. */
  stat: FileStat | null;
  /** Saving… while a save is in flight. Not saved after a save that did not finish. */
  savePhase: SavePhase;
  /** FR-15. Stays true until the next successful save after a conflict Cancel. */
  autosavePaused?: boolean;
  /** The document last opened or written. Paragraph text is filled from the editor at save. */
  baseDocument: DocumentMessage;
  /** View at the last save, or Pages for a new tab. */
  savedView: DocumentView;
  /** Page setup at the last save, or Normal portrait for a new tab. */
  savedPage: PageSetupValue;
  /** Header and footer at the last save. */
  savedHeader: JsonObject;
  savedFooter: JsonObject;
  blockIds: string[];
}

export function documentView(tab: Pick<PageTab, 'baseDocument'>): DocumentView {
  return tab.baseDocument.view === 'pageless' ? 'pageless' : 'pages';
}

export function withDocumentView(tab: PageTab, view: DocumentView): PageTab {
  if (tab.kind === 'settings' || documentView(tab) === view) {
    return tab;
  }
  return {
    ...tab,
    baseDocument: { ...tab.baseDocument, view },
    revision: tab.revision + 1,
  };
}

export function withPageSetup(tab: PageTab, page: PageSetupValue): PageTab {
  if (tab.kind === 'settings' || samePageSetup(pageSetupFromUnknown(tab.baseDocument.page), page)) {
    return tab;
  }
  return {
    ...tab,
    baseDocument: {
      ...tab.baseDocument,
      page: {
        paper: 'letter',
        orientation: page.orientation,
        margins: {
          top: page.margins.top,
          right: page.margins.right,
          bottom: page.margins.bottom,
          left: page.margins.left,
        },
      },
    },
    revision: tab.revision + 1,
  };
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function withBand(tab: PageTab, part: 'header' | 'footer', paragraph: JsonObject): PageTab {
  if (tab.kind === 'settings' || sameJson(tab.baseDocument[part], paragraph)) {
    return tab;
  }
  return {
    ...tab,
    baseDocument: { ...tab.baseDocument, [part]: paragraph },
    revision: tab.revision + 1,
  };
}

export function untitledTitle(number: number): string {
  return `Untitled ${number}`;
}

export function createTab(number: number): PageTab {
  const base = createBaseDocument();
  const editor = createTabEditorState(editorDocFromDocument(base.document));
  return {
    id: `untitled-${number}`,
    title: untitledTitle(number),
    editor,
    savedDoc: editor.doc,
    revision: 0,
    stat: null,
    savePhase: null,
    baseDocument: base.document,
    savedView: 'pages',
    savedPage: defaultPageSetup(),
    savedHeader: base.document.header,
    savedFooter: base.document.footer,
    blockIds: base.blockIds,
  };
}

export function createSettingsTab(): PageTab {
  const base = createBaseDocument();
  const editor = createTabEditorState(editorDocFromDocument(base.document));
  return {
    id: SETTINGS_TAB_ID,
    title: 'Settings',
    kind: 'settings',
    editor,
    savedDoc: editor.doc,
    revision: 0,
    stat: null,
    savePhase: null,
    baseDocument: base.document,
    savedView: 'pages',
    savedPage: defaultPageSetup(),
    savedHeader: base.document.header,
    savedFooter: base.document.footer,
    blockIds: base.blockIds,
  };
}

export function tabHasUnsavedChanges(tab: PageTab): boolean {
  if (tab.kind === 'settings') {
    return false;
  }
  if (documentView(tab) !== tab.savedView) {
    return true;
  }
  if (!samePageSetup(pageSetupFromUnknown(tab.baseDocument.page), tab.savedPage)) {
    return true;
  }
  if (!sameJson(tab.baseDocument.header, tab.savedHeader) || !sameJson(tab.baseDocument.footer, tab.savedFooter)) {
    return true;
  }
  return !tab.editor.doc.eq(tab.savedDoc);
}

export function isReplaceableUntitledTab(tab: PageTab): boolean {
  if (tab.kind === 'settings' || tab.handle !== undefined) {
    return false;
  }
  if (!tab.id.startsWith('untitled-')) {
    return false;
  }
  if (tabHasUnsavedChanges(tab)) {
    return false;
  }
  return tab.editor.doc.textContent.length === 0;
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
