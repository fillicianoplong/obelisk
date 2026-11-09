// Menu bar model (FR-02). Key handling reads this data and does not name commands.
// Adding a Menus reference item is a new entry here, not a change to the keyboard code.
//
// enabled is false while the command does not exist. A submenu stays enabled so it
// can open; its children stay disabled until they apply. Should items (Columns,
// Diagram, Drawing, Signature, Date and time) are left out until they exist, and a
// group that would be empty drops its separator. ellipsis marks an item that asks
// for more input before it acts.

export interface MenuItem {
  id: string;
  label: string;
  /** One character, matched without regard to case. Empty when the label has no free character. */
  accessKey: string;
  /** Which copy of accessKey to underline when the label contains it more than once. */
  accessOccurrence?: number;
  shortcut?: string;
  enabled: boolean;
  ellipsis?: boolean;
  checked?: boolean;
  command?: string;
  submenu?: readonly MenuEntry[];
}

export interface MenuSeparator {
  id: string;
  separator: true;
}

export type MenuEntry = MenuItem | MenuSeparator;

export interface AppMenu {
  id: string;
  label: string;
  accessKey: string;
  accessOccurrence?: number;
  entries: readonly MenuEntry[];
}

export function isSeparator(entry: MenuEntry): entry is MenuSeparator {
  return 'separator' in entry;
}

export function itemLabel(item: Pick<MenuItem, 'label' | 'ellipsis'>): string {
  return item.ellipsis === true ? `${item.label}…` : item.label;
}

/** Visible label, then the shortcut, so the shortcut is part of the accessible name. */
export function accessibleName(item: Pick<MenuItem, 'label' | 'ellipsis' | 'shortcut'>): string {
  const label = itemLabel(item);
  if (item.shortcut !== undefined && item.shortcut.length > 0) {
    return `${label} ${item.shortcut}`;
  }
  return label;
}

export function accessKeyIndex(label: string, accessKey: string, occurrence = 0): number {
  if (accessKey.length !== 1) {
    return -1;
  }
  const needle = accessKey.toLowerCase();
  let seen = 0;
  for (let index = 0; index < label.length; index += 1) {
    if (label.charAt(index).toLowerCase() !== needle) {
      continue;
    }
    if (seen === occurrence) {
      return index;
    }
    seen += 1;
  }
  return -1;
}

export interface AccessParts {
  before: string;
  key: string;
  after: string;
}

export function accessParts(label: string, accessKey: string, occurrence = 0): AccessParts | null {
  const index = accessKeyIndex(label, accessKey, occurrence);
  if (index < 0) {
    return null;
  }
  return {
    before: label.slice(0, index),
    key: label.slice(index, index + 1),
    after: label.slice(index + 1),
  };
}

interface ItemInit {
  id: string;
  label: string;
  accessKey: string;
  accessOccurrence?: number;
  shortcut?: string;
  enabled?: boolean;
  ellipsis?: boolean;
  checked?: boolean;
  command?: string;
  submenu?: readonly MenuEntry[];
}

function item(init: ItemInit): MenuItem {
  return {
    enabled: false,
    ...init,
  };
}

function separator(id: string): MenuSeparator {
  return { id, separator: true };
}

function submenu(id: string, label: string, accessKey: string, entries: readonly MenuEntry[], extra: Partial<ItemInit> = {}): MenuItem {
  return item({ id, label, accessKey, enabled: true, submenu: entries, ...extra });
}

const FONT_ITEMS: readonly MenuEntry[] = [
  item({ id: 'format-font-liberation-serif', label: 'Liberation Serif', accessKey: 'l' }),
  item({ id: 'format-font-liberation-sans', label: 'Liberation Sans', accessKey: 's' }),
  item({ id: 'format-font-liberation-mono', label: 'Liberation Mono', accessKey: 'm' }),
  item({ id: 'format-font-caladea', label: 'Caladea', accessKey: 'c' }),
  item({ id: 'format-font-carlito', label: 'Carlito', accessKey: 'a' }),
  item({ id: 'format-font-dejavu-serif', label: 'DejaVu Serif', accessKey: 'd' }),
  item({ id: 'format-font-dejavu-sans', label: 'DejaVu Sans', accessKey: 'j' }),
  item({ id: 'format-font-dejavu-mono', label: 'DejaVu Sans Mono', accessKey: 'o' }),
  item({ id: 'format-font-libertine', label: 'Linux Libertine G', accessKey: 'x' }),
  item({ id: 'format-font-biolinum', label: 'Linux Biolinum G', accessKey: 'b' }),
  item({ id: 'format-font-noto-serif', label: 'Noto Serif', accessKey: 'n' }),
  item({ id: 'format-font-noto-sans', label: 'Noto Sans', accessKey: 't' }),
  item({ id: 'format-font-dancing', label: 'Dancing Script', accessKey: 'p' }),
];

// 11 pt and 18 pt borrow p and t from the "pt" suffix. 24, 28, and 48 have no
// character left that is not already an access key in this submenu.
const FONT_SIZE_ITEMS: readonly MenuEntry[] = [
  item({ id: 'format-size-8', label: '8 pt', accessKey: '8' }),
  item({ id: 'format-size-9', label: '9 pt', accessKey: '9' }),
  item({ id: 'format-size-10', label: '10 pt', accessKey: '1' }),
  item({ id: 'format-size-11', label: '11 pt', accessKey: 'p' }),
  item({ id: 'format-size-12', label: '12 pt', accessKey: '2' }),
  item({ id: 'format-size-14', label: '14 pt', accessKey: '4' }),
  item({ id: 'format-size-16', label: '16 pt', accessKey: '6' }),
  item({ id: 'format-size-18', label: '18 pt', accessKey: 't' }),
  item({ id: 'format-size-20', label: '20 pt', accessKey: '0' }),
  item({ id: 'format-size-24', label: '24 pt', accessKey: '' }),
  item({ id: 'format-size-28', label: '28 pt', accessKey: '' }),
  item({ id: 'format-size-36', label: '36 pt', accessKey: '3' }),
  item({ id: 'format-size-48', label: '48 pt', accessKey: '' }),
  item({ id: 'format-size-72', label: '72 pt', accessKey: '7' }),
];

const TEXT_ITEMS: readonly MenuEntry[] = [
  item({ id: 'format-bold', label: 'Bold', accessKey: 'b', shortcut: 'Ctrl+B' }),
  item({ id: 'format-italic', label: 'Italic', accessKey: 'i', shortcut: 'Ctrl+I' }),
  item({ id: 'format-underline', label: 'Underline', accessKey: 'u', shortcut: 'Ctrl+U' }),
  item({ id: 'format-strikethrough', label: 'Strikethrough', accessKey: 'k', shortcut: 'Ctrl+Shift+X' }),
  item({ id: 'format-superscript', label: 'Superscript', accessKey: 's' }),
  item({ id: 'format-subscript', label: 'Subscript', accessKey: 'r' }),
  item({ id: 'format-code', label: 'Code', accessKey: 'c' }),
  item({ id: 'format-text-color', label: 'Text color', accessKey: 't' }),
  item({ id: 'format-highlight', label: 'Highlight', accessKey: 'h' }),
];

export const APP_MENUS: readonly AppMenu[] = [
  {
    id: 'file',
    label: 'File',
    accessKey: 'f',
    entries: [
      item({ id: 'file-new', label: 'New', accessKey: 'n', shortcut: 'Ctrl+N', enabled: true, command: 'new' }),
      submenu('file-template', 'New from template', 't', [
        item({ id: 'file-template-mla', label: 'MLA', accessKey: 'm' }),
      ]),
      item({
        id: 'file-open',
        label: 'Open',
        accessKey: 'o',
        shortcut: 'Ctrl+O',
        ellipsis: true,
        enabled: true,
        command: 'open',
      }),
      separator('file-sep-1'),
      item({
        id: 'file-save',
        label: 'Save',
        accessKey: 's',
        shortcut: 'Ctrl+S',
        enabled: true,
        command: 'save',
      }),
      item({
        id: 'file-save-as',
        label: 'Save as',
        accessKey: 'a',
        accessOccurrence: 1,
        shortcut: 'Ctrl+Shift+S',
        ellipsis: true,
        enabled: true,
        command: 'save-as',
      }),
      separator('file-sep-2'),
      item({ id: 'file-print', label: 'Print', accessKey: 'p', shortcut: 'Ctrl+P', ellipsis: true }),
      submenu('file-export', 'Export', 'e', [
        item({ id: 'file-export-pdf', label: 'PDF', accessKey: 'p', ellipsis: true }),
        item({ id: 'file-export-word', label: 'Word', accessKey: 'w', ellipsis: true }),
        item({ id: 'file-export-markdown', label: 'Markdown', accessKey: 'm', ellipsis: true }),
      ], { shortcut: 'Ctrl+Shift+E' }),
      separator('file-sep-3'),
      item({
        id: 'file-close',
        label: 'Close tab',
        accessKey: 'c',
        shortcut: 'Ctrl+W',
        enabled: true,
        command: 'close-tab',
      }),
      item({ id: 'file-exit', label: 'Exit', accessKey: 'x', enabled: true, command: 'exit' }),
    ],
  },
  {
    id: 'edit',
    label: 'Edit',
    accessKey: 'e',
    entries: [
      item({ id: 'edit-undo', label: 'Undo', accessKey: 'u', shortcut: 'Ctrl+Z' }),
      item({ id: 'edit-redo', label: 'Redo', accessKey: 'r', shortcut: 'Ctrl+Y' }),
      separator('edit-sep-1'),
      item({ id: 'edit-cut', label: 'Cut', accessKey: 't', shortcut: 'Ctrl+X' }),
      item({ id: 'edit-copy', label: 'Copy', accessKey: 'c', shortcut: 'Ctrl+C' }),
      item({ id: 'edit-paste', label: 'Paste', accessKey: 'p', shortcut: 'Ctrl+V' }),
      item({ id: 'edit-paste-plain', label: 'Paste as plain text', accessKey: 'l', shortcut: 'Ctrl+Shift+V' }),
      item({ id: 'edit-duplicate', label: 'Duplicate', accessKey: 'd', shortcut: 'Ctrl+D' }),
      item({ id: 'edit-select-all', label: 'Select all', accessKey: 's', shortcut: 'Ctrl+A' }),
      separator('edit-sep-2'),
      item({ id: 'edit-find', label: 'Find', accessKey: 'f', shortcut: 'Ctrl+F' }),
      item({ id: 'edit-replace', label: 'Replace', accessKey: 'e', shortcut: 'Ctrl+H' }),
    ],
  },
  {
    id: 'view',
    label: 'View',
    accessKey: 'v',
    entries: [
      item({ id: 'view-pages', label: 'Pages', accessKey: 'p' }),
      item({ id: 'view-pageless', label: 'Pageless', accessKey: 'g' }),
      separator('view-sep-1'),
      item({ id: 'view-zoom-in', label: 'Zoom in', accessKey: 'i', shortcut: 'Ctrl++' }),
      item({ id: 'view-zoom-out', label: 'Zoom out', accessKey: 'o', accessOccurrence: 2, shortcut: 'Ctrl+-' }),
      item({ id: 'view-zoom-100', label: 'Zoom to 100%', accessKey: '1', shortcut: 'Ctrl+0' }),
    ],
  },
  {
    id: 'insert',
    label: 'Insert',
    accessKey: 'i',
    entries: [
      item({ id: 'insert-text', label: 'Text', accessKey: 'x' }),
      item({ id: 'insert-heading-1', label: 'Heading 1', accessKey: '1' }),
      item({ id: 'insert-heading-2', label: 'Heading 2', accessKey: '2' }),
      item({ id: 'insert-heading-3', label: 'Heading 3', accessKey: '3' }),
      separator('insert-sep-1'),
      item({ id: 'insert-bulleted', label: 'Bulleted list', accessKey: 'b' }),
      item({ id: 'insert-numbered', label: 'Numbered list', accessKey: 'n' }),
      item({ id: 'insert-checklist', label: 'Checklist', accessKey: 'k' }),
      separator('insert-sep-2'),
      item({ id: 'insert-quote', label: 'Quote', accessKey: 'q' }),
      item({ id: 'insert-code', label: 'Code block', accessKey: 'c' }),
      separator('insert-sep-3'),
      item({ id: 'insert-table', label: 'Table', accessKey: 't' }),
      item({ id: 'insert-image', label: 'Image', accessKey: 'i', ellipsis: true }),
      item({ id: 'insert-equation', label: 'Equation', accessKey: 'e' }),
      separator('insert-sep-4'),
      item({ id: 'insert-link', label: 'Link', accessKey: 'l', shortcut: 'Ctrl+K', ellipsis: true }),
      separator('insert-sep-5'),
      item({ id: 'insert-horizontal', label: 'Horizontal line', accessKey: 'h' }),
      item({ id: 'insert-page-break', label: 'Page break', accessKey: 'p', shortcut: 'Ctrl+Enter' }),
    ],
  },
  {
    id: 'format',
    label: 'Format',
    accessKey: 'o',
    entries: [
      submenu('format-text', 'Text', 't', TEXT_ITEMS),
      submenu('format-font', 'Font', 'f', FONT_ITEMS),
      submenu('format-size', 'Font size', 'z', FONT_SIZE_ITEMS),
      item({ id: 'format-paragraph', label: 'Paragraph', accessKey: 'p', ellipsis: true }),
      item({ id: 'format-indent-increase', label: 'Increase indent', accessKey: 'i', shortcut: 'Tab' }),
      item({ id: 'format-indent-decrease', label: 'Decrease indent', accessKey: 'd', shortcut: 'Shift+Tab' }),
      item({ id: 'format-clear', label: 'Clear formatting', accessKey: 'c', shortcut: 'Ctrl+Space' }),
      separator('format-sep-1'),
      item({ id: 'format-page-setup', label: 'Page setup', accessKey: 'u', ellipsis: true }),
      item({ id: 'format-header', label: 'Header and footer', accessKey: 'h' }),
    ],
  },
  {
    id: 'tools',
    label: 'Tools',
    accessKey: 't',
    entries: [
      item({ id: 'tools-spelling', label: 'Spelling', accessKey: 'p', checked: true }),
      item({
        id: 'tools-settings',
        label: 'Settings',
        accessKey: 's',
        shortcut: 'Ctrl+comma',
        enabled: true,
        command: 'settings',
      }),
    ],
  },
  {
    id: 'help',
    label: 'Help',
    accessKey: 'h',
    entries: [
      item({ id: 'help-shortcuts', label: 'Keyboard shortcuts', accessKey: 'k' }),
      item({ id: 'help-about', label: 'About Obelisk', accessKey: 'a' }),
    ],
  },
];

export function menuHasCheck(entries: readonly MenuEntry[]): boolean {
  return entries.some((entry) => !isSeparator(entry) && entry.checked === true);
}
