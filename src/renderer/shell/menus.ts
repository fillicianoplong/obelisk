export interface MenuItem {
  id: string;
  label: string;
  shortcut?: string;
  submenu?: boolean;
  command?: 'new' | 'close-tab';
}

export interface MenuSeparator {
  id: string;
  separator: true;
}

export type MenuEntry = MenuItem | MenuSeparator;

export interface AppMenu {
  id: string;
  label: string;
  entries: MenuEntry[];
}

export function isSeparator(entry: MenuEntry): entry is MenuSeparator {
  return 'separator' in entry;
}

function item(id: string, label: string, extra: Partial<MenuItem> = {}): MenuItem {
  return { id, label, ...extra };
}

function separator(id: string): MenuSeparator {
  return { id, separator: true };
}

// Menus reference in the SRS. File > New and File > Close tab run in this
// shell; later milestones enable the rest. The native application menu stays off.
export const APP_MENUS: readonly AppMenu[] = [
  {
    id: 'file',
    label: 'File',
    entries: [
      item('new', 'New', { shortcut: 'Ctrl+N', command: 'new' }),
      item('new-template', 'New from template', { submenu: true }),
      item('open', 'Open'),
      separator('file-sep-1'),
      item('save', 'Save'),
      item('save-as', 'Save As'),
      separator('file-sep-2'),
      item('print', 'Print'),
      item('export', 'Export', { submenu: true }),
      separator('file-sep-3'),
      item('close-tab', 'Close tab', { shortcut: 'Ctrl+W', command: 'close-tab' }),
      item('exit', 'Exit'),
    ],
  },
  {
    id: 'edit',
    label: 'Edit',
    entries: [
      item('undo', 'Undo'),
      item('redo', 'Redo'),
      separator('edit-sep-1'),
      item('cut', 'Cut'),
      item('copy', 'Copy'),
      item('paste', 'Paste'),
      item('paste-plain', 'Paste as plain text'),
      item('duplicate', 'Duplicate'),
      item('select-all', 'Select all'),
      separator('edit-sep-2'),
      item('find', 'Find'),
      item('replace', 'Replace'),
    ],
  },
  {
    id: 'view',
    label: 'View',
    entries: [
      item('pages', 'Pages'),
      item('pageless', 'Pageless'),
      separator('view-sep-1'),
      item('zoom-in', 'Zoom in'),
      item('zoom-out', 'Zoom out'),
      item('zoom-100', 'Zoom to 100%'),
    ],
  },
  {
    id: 'insert',
    label: 'Insert',
    entries: [
      item('text', 'Text'),
      item('heading-1', 'Heading 1'),
      item('heading-2', 'Heading 2'),
      item('heading-3', 'Heading 3'),
      item('bulleted-list', 'Bulleted list'),
      item('numbered-list', 'Numbered list'),
      item('checklist', 'Checklist'),
      item('quote', 'Quote'),
      item('code-block', 'Code block'),
      item('divider', 'Divider'),
      item('table', 'Table'),
      item('image', 'Image'),
      item('formula', 'Formula'),
      separator('insert-sep-1'),
      item('page-break', 'Page break'),
      item('date-chip', 'Date chip'),
      item('link', 'Link'),
    ],
  },
  {
    id: 'format',
    label: 'Format',
    entries: [
      item('character-marks', 'Character marks'),
      item('font', 'Font'),
      item('size', 'Size'),
      item('paragraph', 'Paragraph'),
      item('indents', 'Indents'),
      item('clear-formatting', 'Clear formatting'),
      separator('format-sep-1'),
      item('page-setup', 'Page setup'),
      item('header-footer', 'Header and footer'),
    ],
  },
  {
    id: 'tools',
    label: 'Tools',
    entries: [item('spelling', 'Spelling'), item('preferences', 'Preferences')],
  },
  {
    id: 'help',
    label: 'Help',
    entries: [item('shortcuts', 'Keyboard shortcuts'), item('about', 'About Obelisk')],
  },
];
