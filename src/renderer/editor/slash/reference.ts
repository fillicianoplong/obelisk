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
  | { kind: 'page-break' };

export interface SlashMenuItem {
  id: string;
  label: string;
  block: SlashMenuBlockRef | null;
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
  { id: 'table', label: 'Table', block: null },
  { id: 'image', label: 'Image', block: null },
  { id: 'equation', label: 'Equation', block: null },
  { id: 'diagram', label: 'Diagram', block: null },
  { id: 'drawing', label: 'Drawing', block: null },
  { id: 'signature', label: 'Signature', block: null },
  { id: 'date', label: 'Date', block: null },
  { id: 'horizontal-line', label: 'Horizontal line', block: { kind: 'divider' } },
  { id: 'page-break', label: 'Page break', block: { kind: 'page-break' } },
];

function group(items: SlashMenuItem[]): SlashMenuEntry[] {
  return items.map((item) => ({
    type: 'item' as const,
    item,
    enabled: item.block !== null,
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
  ...group(EXISTING.slice(10, 17)),
  { type: 'separator' },
  ...group(EXISTING.slice(17, 19)),
];

export const SLASH_MENU_ITEM_LABELS: readonly string[] = EXISTING.map((item) => item.label);
