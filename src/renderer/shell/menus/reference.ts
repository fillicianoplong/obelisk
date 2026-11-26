import type { AppMenu, MenuEntry, MenuItem } from './model.js';
import { isSeparator, itemLabel } from './model.js';

function labelOf(entry: MenuItem): string {
  return itemLabel(entry);
}

/** Menus reference item labels (FR-02). */
export const MENU_REFERENCE_BY_MENU: Readonly<Record<string, readonly string[]>> = {
  File: [
    'New',
    'New from template',
    'MLA',
    'Open…',
    'Save',
    'Save as…',
    'Print…',
    'Export',
    'PDF…',
    'Word…',
    'Markdown…',
    'Close tab',
    'Exit',
  ],
  Edit: [
    'Undo',
    'Redo',
    'Cut',
    'Copy',
    'Paste',
    'Paste as plain text',
    'Duplicate',
    'Select all',
    'Find',
    'Replace',
  ],
  View: ['Pages', 'Pageless', 'Zoom in', 'Zoom out', 'Zoom to 100%'],
  Insert: [
    'Text',
    'Heading 1',
    'Heading 2',
    'Heading 3',
    'Bulleted list',
    'Numbered list',
    'Checklist',
    'Quote',
    'Code block',
    'Columns',
    'Table',
    'Image…',
    'Equation',
    'Diagram',
    'Drawing',
    'Signature',
    'Date and time…',
    'Link…',
    'Horizontal line',
    'Page break',
    'Page number',
    'Page count',
  ],
  Format: [
    'Text',
    'Font',
    'Font size',
    'Paragraph…',
    'Increase indent',
    'Decrease indent',
    'Clear formatting',
    'Page setup…',
    'Header and footer',
  ],
  Tools: ['Spell check', 'Settings'],
  Help: ['Keyboard shortcuts', 'About Obelisk'],
};

const FLATTEN_SUBMENUS = new Set(['file']);

function walkFlat(entries: readonly MenuEntry[], labels: string[]): void {
  for (const entry of entries) {
    if (isSeparator(entry)) {
      continue;
    }
    if (entry.submenu !== undefined) {
      labels.push(labelOf(entry));
      walkFlat(entry.submenu, labels);
      continue;
    }
    labels.push(labelOf(entry));
  }
}

function topLevelLabels(entries: readonly MenuEntry[]): string[] {
  return entries.filter((entry): entry is MenuItem => !isSeparator(entry)).map((entry) => labelOf(entry));
}

export function menuItemLabelsForReference(menu: AppMenu): string[] {
  if (FLATTEN_SUBMENUS.has(menu.id)) {
    const labels: string[] = [];
    walkFlat(menu.entries, labels);
    return labels;
  }
  return topLevelLabels(menu.entries);
}