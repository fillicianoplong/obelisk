/** Slash menu entries in SRS order (six groups, separators between groups). */

export type SlashMenuBlockRef =
  | { kind: 'paragraph' }
  | { kind: 'heading'; level: 1 | 2 | 3 }
  | { kind: 'bulleted-list' }
  | { kind: 'numbered-list' }
  | { kind: 'checklist' }
  | { kind: 'quote' }
  | { kind: 'code' }
  | { kind: 'divider' }
  | { kind: 'page-break' }
  | { kind: 'table' };

export interface SlashMenuItem {
  id: string;
  label: string;
  block: SlashMenuBlockRef | null;
  /** A shell command the item runs instead of inserting a block, such as the Link dialog. */
  command?: 'insert-link' | 'insert-date-time';
}

export interface SlashMenuRow {
  type: 'item';
  item: SlashMenuItem;
  enabled: boolean;
}

export interface SlashMenuSeparator {
  type: 'separator';
}

export type SlashMenuEntry = SlashMenuRow | SlashMenuSeparator;

const EXISTING: SlashMenuItem[] = [
  { id: 'text', label: 'Text', block: { kind: 'paragraph' } },
  { id: 'heading-1', label: 'Heading 1', block: { kind: 'heading', level: 1 } },
  { id: 'heading-2', label: 'Heading 2', block: { kind: 'heading', level: 2 } },
  { id: 'heading-3', label: 'Heading 3', block: { kind: 'heading', level: 3 } },
  { id: 'bulleted-list', label: 'Bulleted list', block: { kind: 'bulleted-list' } },
  { id: 'numbered-list', label: 'Numbered list', block: { kind: 'numbered-list' } },
  { id: 'checklist', label: 'Checklist', block: { kind: 'checklist' } },
  { id: 'quote', label: 'Quote', block: { kind: 'quote' } },
  { id: 'code-block', label: 'Code block', block: { kind: 'code' } },
  { id: 'columns', label: 'Columns', block: null },
  { id: 'table', label: 'Table', block: { kind: 'table' } },
  { id: 'image', label: 'Image', block: null },
  { id: 'equation', label: 'Equation', block: null },
  { id: 'diagram', label: 'Diagram', block: null },
  { id: 'drawing', label: 'Drawing', block: null },
  { id: 'signature', label: 'Signature', block: null },
  { id: 'date', label: 'Date', block: null, command: 'insert-date-time' },
  { id: 'link', label: 'Link', block: null, command: 'insert-link' },
  { id: 'horizontal-line', label: 'Horizontal line', block: { kind: 'divider' } },
  { id: 'page-break', label: 'Page break', block: { kind: 'page-break' } },
];

function group(items: SlashMenuItem[]): SlashMenuEntry[] {
  return items.map((item) => ({
    type: 'item' as const,
    item,
    enabled: item.block !== null || item.command !== undefined,
  }));
}

/** Flat menu model with separators between the six SRS groups. */
export const SLASH_MENU_ENTRIES: readonly SlashMenuEntry[] = [
  ...group(EXISTING.slice(0, 4)),
  { type: 'separator' },
  ...group(EXISTING.slice(4, 7)),
  { type: 'separator' },
  ...group(EXISTING.slice(7, 9)),
  { type: 'separator' },
  ...group(EXISTING.slice(9, 10)),
  { type: 'separator' },
  ...group(EXISTING.slice(10, 18)),
  { type: 'separator' },
  ...group(EXISTING.slice(18, 20)),
];

export const SLASH_MENU_ITEM_LABELS: readonly string[] = EXISTING.map((item) => item.label);

/** Lowercase search aliases from the Slash menu reference. */
export const SLASH_ITEM_SEARCH_WORDS: Readonly<Record<string, readonly string[]>> = {
  text: ['paragraph', 'p'],
  'heading-1': ['h1', 'title'],
  'heading-2': ['h2'],
  'heading-3': ['h3'],
  'bulleted-list': ['ul', 'list'],
  'numbered-list': ['ol'],
  checklist: ['todo'],
  quote: ['blockquote'],
  'code-block': ['code'],
  columns: ['column', 'side by side'],
  table: ['grid', 'tab'],
  image: ['picture', 'photo', 'img'],
  equation: ['equation', 'math', 'latex', 'formula'],
  diagram: ['mermaid', 'flowchart', 'chart'],
  drawing: ['draw', 'sketch', 'pad'],
  signature: ['sign', 'signature'],
  date: ['date', 'time', 'today', 'now'],
  link: ['url', 'hyperlink', 'web', 'address'],
  'horizontal-line': ['hr', 'line', 'divider'],
  'page-break': ['break', 'new page'],
};
