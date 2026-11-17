import type { EditorState } from 'prosemirror-state';
import { editorMenuCommandEnabled } from '../../editor/menu-commands.js';
import type { AppMenu, MenuEntry, MenuItem } from './model.js';
import { APP_MENUS, isSeparator } from './model.js';

const NEEDS_RANGE = new Set([
  'edit-cut',
  'edit-copy',
  'format-bold',
  'format-italic',
  'format-underline',
  'format-strikethrough',
  'format-superscript',
  'format-subscript',
  'format-code',
  'format-text-color',
  'format-highlight',
  'format-clear',
]);

/** Present in the menu bar but not wired to a handler yet. */
export const UNWIRED_MENU_IDS: ReadonlySet<string> = new Set([
  'edit-cut',
  'edit-copy',
  'edit-paste',
  'edit-paste-plain',
  'edit-find',
  'edit-replace',
  'file-template-mla',
  'file-print',
  'file-export-pdf',
  'file-export-word',
  'file-export-markdown',
  'view-pages',
  'view-pageless',
  'view-zoom-in',
  'view-zoom-out',
  'view-zoom-100',
  'insert-columns',
  'insert-table',
  'insert-image',
  'insert-equation',
  'insert-diagram',
  'insert-drawing',
  'insert-signature',
  'insert-date-time',
  'insert-link',
  'format-paragraph',
  'format-page-setup',
  'format-header',
  'tools-spelling',
  'help-shortcuts',
  'help-about',
]);

const SHELL_ALWAYS = new Set([
  'file-new',
  'file-open',
  'file-save',
  'file-save-as',
  'file-close',
  'file-exit',
  'tools-settings',
]);

export interface LiveMenuContext {
  documentTab: boolean;
  selectionEmpty: boolean;
  editorState: EditorState | null;
}

function hasSubmenu(item: MenuItem): boolean {
  return item.submenu !== undefined && item.submenu.length > 0;
}

function leafEnabled(item: MenuItem, context: LiveMenuContext): boolean {
  if (UNWIRED_MENU_IDS.has(item.id)) {
    return false;
  }
  if (SHELL_ALWAYS.has(item.id)) {
    return true;
  }
  if (!context.documentTab || context.editorState === null) {
    return false;
  }
  if (item.command === undefined) {
    return false;
  }
  if (NEEDS_RANGE.has(item.id) && context.selectionEmpty) {
    return false;
  }
  if (
    (item.id.startsWith('format-font-') || item.id.startsWith('format-size-'))
    && context.selectionEmpty
  ) {
    return false;
  }
  return editorMenuCommandEnabled(context.editorState, item.id);
}

function submenuParentEnabled(item: MenuItem, context: LiveMenuContext): boolean {
  if (item.id === 'file-export' || item.id === 'file-template') {
    return true;
  }
  if (item.id.startsWith('format-') && hasSubmenu(item)) {
    return context.documentTab && context.editorState !== null;
  }
  return false;
}

function applyItem(item: MenuItem, context: LiveMenuContext): MenuItem {
  if (hasSubmenu(item)) {
    const submenu = applyEntries(item.submenu!, context);
    return {
      ...item,
      enabled: submenuParentEnabled(item, context),
      submenu,
    };
  }
  return { ...item, enabled: leafEnabled(item, context) };
}

function applyEntries(entries: readonly MenuEntry[], context: LiveMenuContext): readonly MenuEntry[] {
  return entries.map((entry) => (isSeparator(entry) ? entry : applyItem(entry, context)));
}

export function liveMenus(context: LiveMenuContext): readonly AppMenu[] {
  return APP_MENUS.map((menu) => ({
    ...menu,
    entries: applyEntries(menu.entries, context),
  }));
}