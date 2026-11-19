import type { Node as ProseNode } from 'prosemirror-model';
import type { EditorState, Transaction } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import { blockIndexAtPos } from '../block-handle-plugin.js';
import { caretInsideBlock, createTextBlockNode } from '../block-commands.js';
import { newBlockId } from '../block-id.js';
import type { TextBlockKind } from '../schema/index.js';
import {
  SLASH_MENU_ENTRIES,
  SLASH_ITEM_SEARCH_WORDS,
  type SlashMenuBlockRef,
  type SlashMenuItem,
  type SlashMenuRow,
} from './reference.js';
function selectableRows(): SlashMenuRow[] {
  return SLASH_MENU_ENTRIES.filter((entry): entry is SlashMenuRow => entry.type === 'item');
}

export function slashTypedQuery(state: EditorState, slashPos: number): string {
  return slashTypedQueryFromSelection(state.doc, state.selection, slashPos);
}

export function slashTypedQueryFromSelection(
  doc: ProseNode,
  selection: EditorState['selection'],
  slashPos: number,
): string {
  const { head } = selection;
  if (!(selection instanceof TextSelection) || !selection.empty || head <= slashPos + 1) {
    return '';
  }
  return doc.textBetween(slashPos + 1, head, '\0', '\0');
}

export function slashMenuContextActive(
  doc: ProseNode,
  selection: EditorState['selection'],
  slashPos: number,
): boolean {
  if (!(selection instanceof TextSelection) || !selection.empty || selection.head <= slashPos) {
    return false;
  }
  if (doc.textBetween(slashPos, slashPos + 1, '\0', '\0') !== '/') {
    return false;
  }
  const query = doc.textBetween(slashPos + 1, selection.head, '\0', '\0');
  return /^[\w-]*$/i.test(query);
}

function rowMatchesQuery(row: SlashMenuRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return true;
  }
  const { item } = row;
  const tokens = [item.id.replace(/-/g, ' '), item.label, ...(SLASH_ITEM_SEARCH_WORDS[item.id] ?? [])];
  return tokens.some((token) => token.toLowerCase().includes(needle) || token.toLowerCase().startsWith(needle));
}

export function filteredSlashMenuRows(query: string): SlashMenuRow[] {
  const enabled = selectableRows().filter((row) => row.enabled);
  if (query.length === 0) {
    return enabled;
  }
  return enabled.filter((row) => rowMatchesQuery(row, query));
}

export function firstFilteredIndex(query: string): number {
  const rows = selectableRows();
  const filtered = filteredSlashMenuRows(query);
  const first = filtered[0];
  if (first === undefined) {
    return 0;
  }
  return rows.findIndex((row) => row.item.id === first.item.id);
}

const EXACT_SLASH_IDS: Readonly<Record<string, string>> = {
  p: 'text',
  paragraph: 'text',
  text: 'text',
  h1: 'heading-1',
  h2: 'heading-2',
  h3: 'heading-3',
  title: 'heading-1',
  list: 'bulleted-list',
  ul: 'bulleted-list',
  ol: 'numbered-list',
  todo: 'checklist',
  quote: 'quote',
  blockquote: 'quote',
  code: 'code-block',
  hr: 'horizontal-line',
  line: 'horizontal-line',
  divider: 'horizontal-line',
  break: 'page-break',
};

function slashItemById(itemId: string): SlashMenuItem | null {
  const row = selectableRows().find((entry) => entry.item.id === itemId);
  return row?.item ?? null;
}

export function exactSlashCommandItem(state: EditorState, slashPos: number): SlashMenuItem | null {
  const query = slashTypedQuery(state, slashPos).trim().toLowerCase();
  if (query.length === 0) {
    return null;
  }
  const mapped = EXACT_SLASH_IDS[query];
  if (mapped !== undefined) {
    return slashItemById(mapped);
  }
  return slashItemById(query);
}

function blockRefToKind(ref: SlashMenuBlockRef): { kind: TextBlockKind; level?: number } {
  switch (ref.kind) {
    case 'paragraph':
      return { kind: 'paragraph' };
    case 'heading':
      return { kind: 'heading', level: ref.level };
    case 'bulleted-list':
      return { kind: 'bulleted-list' };
    case 'numbered-list':
      return { kind: 'numbered-list' };
    case 'checklist':
      return { kind: 'checklist' };
    case 'quote':
      return { kind: 'quote' };
    case 'code':
      return { kind: 'code' };
    case 'divider':
      return { kind: 'divider' };
    case 'page-break':
      return { kind: 'page-break' };
    default:
      return { kind: 'paragraph' };
  }
}

function replaceTopLevelBlock(tr: Transaction, blockIndex: number, ref: SlashMenuBlockRef, mint: () => string): Transaction {
  const old = tr.doc.child(blockIndex);
  const priorBlockId = typeof old.attrs.blockId === 'string' ? old.attrs.blockId : mint();
  let pos = 0;
  for (let index = 0; index < blockIndex; index += 1) {
    pos += tr.doc.child(index).nodeSize;
  }
  const { kind, level } = blockRefToKind(ref);
  const node = createTextBlockNode(kind, tr.doc.type.schema, () => priorBlockId, { level });
  const replaced = tr.replaceWith(pos, pos + old.nodeSize, node);
  const selection = caretInsideBlock(replaced.doc, blockIndex, 0);
  return replaced.setSelection(selection);
}

export function applySlashMenuItem(state: EditorState, slashPos: number, item: SlashMenuItem): Transaction | null {
  if (item.block === null) {
    return null;
  }
  const head = state.selection.head;
  const tr = state.tr.delete(slashPos, head);
  const blockIndex = blockIndexAtPos(tr.doc, slashPos);
  return replaceTopLevelBlock(tr, blockIndex, item.block, newBlockId);
}