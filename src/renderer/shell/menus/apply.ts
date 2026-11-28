import type { EditorState } from 'prosemirror-state';
import { editorMenuCommandEnabled } from '../../editor/menu-commands.js';
import { DEFAULT_ZOOM, zoomFromSaved, zoomInDisabled, zoomOutDisabled } from '../../../shared/zoom.js';
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
export const CONTEXT_ONLY_UNWIRED: ReadonlySet<string> = new Set([
  'ctx-spelling',
  'block-insert-above',
  'block-insert-below',
  'block-turn-into-text',
  'block-turn-into-heading-1',
  'block-turn-into-heading-2',
  'block-turn-into-heading-3',
  'block-turn-into-bulleted',
  'block-turn-into-numbered',
  'block-turn-into-checklist',
  'block-turn-into-quote',
  'block-turn-into-code',
  'image-alt-text',
  'image-rotate-left',
  'image-rotate-right',
  'image-flip-horizontal',
  'image-flip-vertical',
  'image-draw',
  'image-reset-size',
  'image-replace',
  'equation-edit-latex',
  'equation-copy-latex',
  'column-add',
  'column-remove',
  'column-even-widths',
  'drawing-clear',
  'drawing-reset-size',
  'diagram-edit-source',
  'diagram-copy-source',
  'signature-change',
  'signature-edit-labels',
  'signature-blank-mode',
  'signature-reset-size',
  'inline-equation-edit',
  'inline-equation-copy',
  'date-time-edit',
  'date-time-format',
  'date-time-convert',
  'date-time-remove',
]);

export const UNWIRED_MENU_IDS: ReadonlySet<string> = new Set([
  'file-print',
  'insert-columns',
  'insert-image',
  'insert-equation',
  'insert-drawing',
  'insert-signature',
  'insert-date-time',
  'format-paragraph',
  'help-shortcuts',
]);

const SHELL_ALWAYS = new Set([
  'file-new',
  'file-template-mla',
  'file-open',
  'file-save',
  'file-save-as',
  'file-close',
  'file-exit',
  'tools-settings',
  'tools-spelling',
  'help-about',
]);

const SHELL_DOCUMENT = new Set([
  'edit-find',
  'edit-replace',
  'file-export-pdf',
  'file-export-word',
  'file-export-markdown',
]);

export interface LiveMenuContext {
  documentTab: boolean;
  selectionEmpty: boolean;
  editorState: EditorState | null;
  spelling?: boolean;
  documentView?: 'pages' | 'pageless';
  zoom?: number;
  bandEditing?: boolean;
}

function hasSubmenu(item: MenuItem): boolean {
  return item.submenu !== undefined && item.submenu.length > 0;
}

function leafEnabled(item: MenuItem, context: LiveMenuContext): boolean {
  if (UNWIRED_MENU_IDS.has(item.id) || CONTEXT_ONLY_UNWIRED.has(item.id)) {
    return false;
  }
  if (SHELL_ALWAYS.has(item.id)) {
    return true;
  }
  if (SHELL_DOCUMENT.has(item.id)) {
    return context.documentTab && context.editorState !== null;
  }
  if (!context.documentTab || context.editorState === null) {
    return false;
  }
  if (item.command === 'spell-add' || item.command?.startsWith('spell-replace:') === true) {
    return context.documentTab && context.editorState !== null;
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
  if (item.id === 'format-page-setup') {
    return context.documentView !== 'pageless';
  }
  if (item.id === 'format-header') {
    return context.documentView !== 'pageless';
  }
  if (
    item.id === 'insert-page-count'
    || item.id.startsWith('insert-page-number-')
  ) {
    return context.bandEditing === true;
  }
  try {
    return editorMenuCommandEnabled(context.editorState, item.id);
  } catch {
    return false;
  }
}

function submenuParentEnabled(item: MenuItem, context: LiveMenuContext): boolean {
  if (item.id === 'file-export') {
    return context.documentTab;
  }
  if (item.id === 'file-template') {
    return true;
  }
  if (item.id === 'block-turn-into') {
    return context.documentTab && context.editorState !== null;
  }
  if (item.id.startsWith('format-') && hasSubmenu(item)) {
    return context.documentTab && context.editorState !== null;
  }
  if (item.id === 'insert-page-number') {
    return context.bandEditing === true;
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
  const enabled = leafEnabled(item, context);
  if (item.id === 'tools-spelling') {
    return { ...item, enabled, checked: context.spelling !== false };
  }
  if (item.id === 'view-pages' || item.id === 'view-pageless') {
    const view = context.documentView === 'pageless' ? 'pageless' : 'pages';
    const checked = item.id === 'view-pageless' ? view === 'pageless' : view === 'pages';
    return { ...item, enabled: context.documentTab, checked };
  }
  if (item.id === 'view-zoom-in' || item.id === 'view-zoom-out' || item.id === 'view-zoom-100') {
    const zoom = zoomFromSaved(context.zoom ?? DEFAULT_ZOOM);
    if (item.id === 'view-zoom-in') {
      return { ...item, enabled: !zoomInDisabled(zoom) };
    }
    if (item.id === 'view-zoom-out') {
      return { ...item, enabled: !zoomOutDisabled(zoom) };
    }
    return { ...item, enabled: true };
  }
  return { ...item, enabled };
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

export function liveMenuEntries(
  entries: readonly MenuEntry[],
  context: LiveMenuContext,
): readonly MenuEntry[] {
  return applyEntries(entries, context);
}