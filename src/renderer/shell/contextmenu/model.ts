import type { MenuEntry, MenuItem } from '../menus/model.js';
import { isSeparator, itemLabel } from '../menus/model.js';

interface ItemInit {
  id: string;
  label: string;
  accessKey: string;
  accessOccurrence?: number;
  shortcut?: string;
  enabled?: boolean;
  ellipsis?: boolean;
  command?: string;
  submenu?: readonly MenuEntry[];
}

function item(init: ItemInit): MenuItem {
  return {
    enabled: false,
    ...init,
  };
}

function separator(id: string) {
  return { id, separator: true as const };
}

function submenu(id: string, label: string, accessKey: string, entries: readonly MenuEntry[]): MenuItem {
  return item({ id, label, accessKey, enabled: true, submenu: entries });
}

const TURN_INTO_ITEMS: readonly MenuEntry[] = [
  item({ id: 'block-turn-into-text', label: 'Text', accessKey: 'x' }),
  item({ id: 'block-turn-into-heading-1', label: 'Heading 1', accessKey: '1' }),
  item({ id: 'block-turn-into-heading-2', label: 'Heading 2', accessKey: '2' }),
  item({ id: 'block-turn-into-heading-3', label: 'Heading 3', accessKey: '3' }),
  item({ id: 'block-turn-into-bulleted', label: 'Bulleted list', accessKey: 'b' }),
  item({ id: 'block-turn-into-numbered', label: 'Numbered list', accessKey: 'n' }),
  item({ id: 'block-turn-into-checklist', label: 'Checklist', accessKey: 'k' }),
  item({ id: 'block-turn-into-quote', label: 'Quote', accessKey: 'q' }),
  item({ id: 'block-turn-into-code', label: 'Code block', accessKey: 'c' }),
];

export const TEXT_MENU_ENTRIES: readonly MenuEntry[] = [
  item({ id: 'ctx-spelling', label: 'Spelling suggestions', accessKey: 's' }),
  separator('ctx-text-sep-1'),
  item({ id: 'edit-cut', label: 'Cut', accessKey: 't', shortcut: 'Ctrl+X', command: 'edit-cut' }),
  item({ id: 'edit-copy', label: 'Copy', accessKey: 'c', shortcut: 'Ctrl+C', command: 'edit-copy' }),
  item({ id: 'edit-paste', label: 'Paste', accessKey: 'p', shortcut: 'Ctrl+V', command: 'edit-paste' }),
  item({
    id: 'edit-paste-plain',
    label: 'Paste as plain text',
    accessKey: 'l',
    shortcut: 'Ctrl+Shift+V',
    command: 'edit-paste-plain',
  }),
  item({ id: 'insert-link', label: 'Link', accessKey: 'k', shortcut: 'Ctrl+K', ellipsis: true, command: 'insert-link' }),
  item({ id: 'format-clear', label: 'Clear formatting', accessKey: 'r', shortcut: 'Ctrl+Space', command: 'format-clear' }),
];

export function blockHandleEntries(options: { omitTurnInto?: boolean } = {}): MenuEntry[] {
  const entries: MenuEntry[] = [
    item({ id: 'edit-cut', label: 'Cut', accessKey: 't', shortcut: 'Ctrl+X', command: 'edit-cut' }),
    item({ id: 'edit-copy', label: 'Copy', accessKey: 'c', shortcut: 'Ctrl+C', command: 'edit-copy' }),
    item({ id: 'edit-paste', label: 'Paste', accessKey: 'p', shortcut: 'Ctrl+V', command: 'edit-paste' }),
    item({ id: 'edit-duplicate', label: 'Duplicate', accessKey: 'd', shortcut: 'Ctrl+D', command: 'edit-duplicate' }),
    item({ id: 'block-delete', label: 'Delete', accessKey: 'e', command: 'block-delete' }),
  ];
  if (options.omitTurnInto !== true) {
    entries.push(submenu('block-turn-into', 'Turn into', 'u', TURN_INTO_ITEMS));
  }
  entries.push(
    item({ id: 'block-insert-above', label: 'Insert above', accessKey: 'a', command: 'block-insert-above' }),
    item({ id: 'block-insert-below', label: 'Insert below', accessKey: 'b', accessOccurrence: 1, command: 'block-insert-below' }),
    item({ id: 'block-move-up', label: 'Move up', accessKey: 'u', accessOccurrence: 1, command: 'block-move-up' }),
    item({ id: 'block-move-down', label: 'Move down', accessKey: 'w', command: 'block-move-down' }),
  );
  return entries;
}

const TABLE_OWN: readonly MenuEntry[] = [
  item({ id: 'table-insert-row-above', label: 'Insert row above', accessKey: 'a', command: 'table-insert-row-above' }),
  item({ id: 'table-insert-row-below', label: 'Insert row below', accessKey: 'b', command: 'table-insert-row-below' }),
  item({ id: 'table-insert-column-left', label: 'Insert column left', accessKey: 'l', command: 'table-insert-column-left' }),
  item({ id: 'table-insert-column-right', label: 'Insert column right', accessKey: 'r', command: 'table-insert-column-right' }),
  separator('table-sep-1'),
  item({ id: 'table-delete-row', label: 'Delete row', accessKey: 'd', command: 'table-delete-row' }),
  item({ id: 'table-delete-column', label: 'Delete column', accessKey: 'e', command: 'table-delete-column' }),
  separator('table-sep-2'),
  item({ id: 'table-sort-ascending', label: 'Sort ascending', accessKey: 's', command: 'table-sort-ascending' }),
  item({ id: 'table-sort-descending', label: 'Sort descending', accessKey: 'o', command: 'table-sort-descending' }),
  item({ id: 'table-header-row', label: 'Header row', accessKey: 'h', command: 'table-header-row' }),
];

const IMAGE_OWN: readonly MenuEntry[] = [
  item({ id: 'image-alt-text', label: 'Alt text', accessKey: 'a', ellipsis: true }),
  item({ id: 'image-rotate-left', label: 'Rotate left', accessKey: 'l' }),
  item({ id: 'image-rotate-right', label: 'Rotate right', accessKey: 'r' }),
  item({ id: 'image-flip-horizontal', label: 'Flip horizontal', accessKey: 'h' }),
  item({ id: 'image-flip-vertical', label: 'Flip vertical', accessKey: 'v' }),
  item({ id: 'image-draw', label: 'Draw on image', accessKey: 'w' }),
  item({ id: 'image-reset-size', label: 'Reset size', accessKey: 's' }),
  item({ id: 'image-replace', label: 'Replace', accessKey: 'p', ellipsis: true }),
];

const EQUATION_BLOCK_OWN: readonly MenuEntry[] = [
  item({ id: 'equation-edit-latex', label: 'Edit LaTeX', accessKey: 'e' }),
  item({ id: 'equation-copy-latex', label: 'Copy LaTeX', accessKey: 'c' }),
];

const COLUMN_OWN: readonly MenuEntry[] = [
  item({ id: 'column-add', label: 'Add column', accessKey: 'a' }),
  item({ id: 'column-remove', label: 'Remove column', accessKey: 'r' }),
  item({ id: 'column-even-widths', label: 'Even widths', accessKey: 'e' }),
];

const DRAWING_OWN: readonly MenuEntry[] = [
  item({ id: 'drawing-clear', label: 'Clear drawing', accessKey: 'c' }),
  item({ id: 'drawing-reset-size', label: 'Reset size', accessKey: 's' }),
];

const DIAGRAM_OWN: readonly MenuEntry[] = [
  item({ id: 'diagram-edit-source', label: 'Edit source', accessKey: 'e' }),
  item({ id: 'diagram-copy-source', label: 'Copy source', accessKey: 'c' }),
];

const SIGNATURE_OWN: readonly MenuEntry[] = [
  item({ id: 'signature-change', label: 'Change signature', accessKey: 'c', ellipsis: true, command: 'signature-change' }),
  item({ id: 'signature-edit-labels', label: 'Edit line and labels', accessKey: 'e', ellipsis: true, command: 'signature-edit-labels' }),
  item({ id: 'signature-blank-mode', label: 'Blank mode', accessKey: 'b', command: 'signature-blank-mode' }),
  item({ id: 'signature-reset-size', label: 'Reset size', accessKey: 's', command: 'signature-reset-size' }),
];

const LINK_OWN: readonly MenuEntry[] = [
  item({ id: 'link-open', label: 'Open link', accessKey: 'o', command: 'link-open' }),
  item({ id: 'link-edit', label: 'Edit link', accessKey: 'e', ellipsis: true, command: 'link-edit' }),
  item({ id: 'link-remove', label: 'Remove link', accessKey: 'r', command: 'link-remove' }),
];

const INLINE_EQUATION_OWN: readonly MenuEntry[] = [
  item({ id: 'inline-equation-edit', label: 'Edit LaTeX', accessKey: 'e' }),
  item({ id: 'inline-equation-copy', label: 'Copy LaTeX', accessKey: 'c' }),
];

const DATE_TIME_OWN: readonly MenuEntry[] = [
  item({ id: 'date-time-edit', label: 'Edit date and time', accessKey: 'e', ellipsis: true }),
  item({ id: 'date-time-format', label: 'Change format', accessKey: 'f' }),
  item({ id: 'date-time-convert', label: 'Convert to text', accessKey: 't' }),
  item({ id: 'date-time-remove', label: 'Remove', accessKey: 'r' }),
];

export type ContextTargetKind =
  | 'text'
  | 'block'
  | 'table-cell'
  | 'image'
  | 'equation-block'
  | 'column-row'
  | 'drawing-pad'
  | 'diagram'
  | 'signature'
  | 'link'
  | 'inline-equation'
  | 'date-time';

function joinSections(sections: readonly (readonly MenuEntry[])[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const section of sections) {
    if (section.length === 0) {
      continue;
    }
    if (out.length > 0) {
      out.push(separator(`ctx-sep-${out.length}`));
    }
    out.push(...section);
  }
  return out;
}

export interface SpellingMenuInfo {
  word: string;
  suggestions: readonly string[];
}

function spellingSuggestionEntries(info: SpellingMenuInfo): MenuEntry[] {
  const rows: MenuEntry[] = info.suggestions.slice(0, 5).map((suggestion, index) => item({
    id: `ctx-spelling-${index}`,
    label: suggestion,
    accessKey: '',
    enabled: true,
    command: `spell-replace:${index}`,
  }));
  if (rows.length === 0) {
    rows.push(item({
      id: 'ctx-spelling-none',
      label: 'No suggestions',
      accessKey: '',
      enabled: false,
    }));
  }
  rows.push(item({
    id: 'ctx-spelling-add',
    label: 'Add to dictionary',
    accessKey: '',
    enabled: true,
    command: 'spell-add',
  }));
  return rows;
}

export function withSpellingSuggestions(
  entries: readonly MenuEntry[],
  info: SpellingMenuInfo | null,
): MenuEntry[] {
  if (info === null || info.word.length === 0) {
    return [...entries];
  }
  const out: MenuEntry[] = [];
  for (const entry of entries) {
    if (!isSeparator(entry) && entry.id === 'ctx-spelling') {
      out.push(...spellingSuggestionEntries(info));
      continue;
    }
    out.push(entry);
  }
  return out;
}

export function composeContextMenu(kind: ContextTargetKind): readonly MenuEntry[] {
  switch (kind) {
    case 'text':
      return TEXT_MENU_ENTRIES;
    case 'block':
      return blockHandleEntries();
    case 'table-cell':
      return joinSections([blockHandleEntries(), TABLE_OWN]);
    case 'image':
      return joinSections([blockHandleEntries(), IMAGE_OWN]);
    case 'equation-block':
      return joinSections([blockHandleEntries(), EQUATION_BLOCK_OWN]);
    case 'column-row':
      return joinSections([blockHandleEntries(), COLUMN_OWN]);
    case 'drawing-pad':
      return joinSections([blockHandleEntries(), DRAWING_OWN]);
    case 'diagram':
      return joinSections([blockHandleEntries(), DIAGRAM_OWN]);
    case 'signature':
      return joinSections([blockHandleEntries({ omitTurnInto: true }), SIGNATURE_OWN]);
    case 'link':
      return joinSections([TEXT_MENU_ENTRIES, LINK_OWN]);
    case 'inline-equation':
      return joinSections([TEXT_MENU_ENTRIES, INLINE_EQUATION_OWN]);
    case 'date-time':
      return joinSections([TEXT_MENU_ENTRIES, DATE_TIME_OWN]);
    default:
      return TEXT_MENU_ENTRIES;
  }
}

export function menuEntryLabels(entries: readonly MenuEntry[]): string[] {
  const labels: string[] = [];
  for (const entry of entries) {
    if (isSeparator(entry)) {
      continue;
    }
    labels.push(itemLabel(entry));
    if (entry.submenu !== undefined) {
      for (const child of entry.submenu) {
        if (!isSeparator(child)) {
          labels.push(itemLabel(child));
        }
      }
    }
  }
  return labels;
}