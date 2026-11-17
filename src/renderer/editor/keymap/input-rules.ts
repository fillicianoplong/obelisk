import {
  InputRule,
  inputRules,
} from 'prosemirror-inputrules';
import type { Attrs, MarkType, NodeType } from 'prosemirror-model';
import type { EditorState, Transaction } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import { newBlockId } from '../block-id.js';
import { editorSchema } from '../schema/index.js';
import { typedShortcutsAllowed } from './guards.js';
import { markCloseHistoryGroup } from '../history/groups.js';

function blockIdAtTextblock(state: EditorState, pos: number): string {
  const blockId = state.doc.resolve(pos).parent.attrs.blockId;
  if (typeof blockId === 'string' && blockId.length > 0) {
    return blockId;
  }
  return newBlockId();
}

function guardHandler(
  handler: (state: EditorState, match: RegExpMatchArray, start: number, end: number) => Transaction | null,
): (state: EditorState, match: RegExpMatchArray, start: number, end: number) => Transaction | null {
  return (state, match, start, end) => {
    if (!typedShortcutsAllowed(state)) {
      return null;
    }
    return handler(state, match, start, end);
  };
}

function guardedRule(
  match: RegExp,
  handler: (state: EditorState, match: RegExpMatchArray, start: number, end: number) => Transaction | null,
  options?: { undoable?: boolean; inCode?: boolean | 'only' },
): InputRule {
  return new InputRule(match, guardHandler(handler), options);
}

function finishInputRule(tr: Transaction, selectionPos: number): Transaction {
  const pos = Math.min(selectionPos, tr.doc.content.size);
  return markCloseHistoryGroup(
    tr.setStoredMarks([]).setSelection(TextSelection.near(tr.doc.resolve(pos), 1)),
  );
}

function replaceParagraphWithList(
  state: EditorState,
  start: number,
  end: number,
  listType: NodeType,
  itemType: NodeType,
  itemAttrs: Attrs,
): Transaction | null {
  const $from = state.doc.resolve(start);
  if ($from.parent.type !== editorSchema.nodes.paragraph) {
    return null;
  }
  const blockId = blockIdAtTextblock(state, start);
  const tr = state.tr.delete(start, end);
  const $after = tr.doc.resolve(Math.min(start, tr.doc.content.size));
  if ($after.parent.type !== editorSchema.nodes.paragraph) {
    return null;
  }
  const listPos = $after.before();
  const paragraphSize = $after.parent.nodeSize;
  const inline = $after.parent.content.size > 0 ? $after.parent.content : null;
  const item = itemType.create(itemAttrs, inline);
  const list = listType.create({ blockId }, [item]);
  const replaced = tr.replaceWith(listPos, listPos + paragraphSize, list);
  return finishInputRule(replaced, listPos + 2);
}

function replaceParagraphWithQuote(
  state: EditorState,
  start: number,
  end: number,
): Transaction | null {
  const $from = state.doc.resolve(start);
  if ($from.parent.type !== editorSchema.nodes.paragraph) {
    return null;
  }
  const blockId = blockIdAtTextblock(state, start);
  const tr = state.tr.delete(start, end);
  const $after = tr.doc.resolve(Math.min(start, tr.doc.content.size));
  if ($after.parent.type !== editorSchema.nodes.paragraph) {
    return null;
  }
  const quotePos = $after.before();
  const paragraphSize = $after.parent.nodeSize;
  const inline = $after.parent.content.size > 0 ? $after.parent.content : null;
  const quote = editorSchema.nodes.blockquote.create({ blockId }, inline);
  const replaced = tr.replaceWith(quotePos, quotePos + paragraphSize, quote);
  return finishInputRule(replaced, quotePos + 1);
}

function runTextblockTypeInputRule(
  state: EditorState,
  start: number,
  end: number,
  nodeType: NodeType,
  attrs: Attrs,
): Transaction | null {
  const $start = state.doc.resolve(start);
  if (!$start.node(-1).canReplaceWith($start.index(-1), $start.indexAfter(-1), nodeType)) {
    return null;
  }
  const typed = state.tr.delete(start, end).setBlockType(start, start, nodeType, attrs);
  return finishInputRule(typed, start);
}

function headingRule(level: number, pattern: RegExp): InputRule {
  return guardedRule(pattern, (state, _match, start, end) => {
    const $start = state.doc.resolve(start);
    if ($start.parent.type !== editorSchema.nodes.paragraph) {
      return null;
    }
    const blockId = blockIdAtTextblock(state, start);
    return runTextblockTypeInputRule(state, start, end, editorSchema.nodes.heading, { blockId, level });
  });
}

function markInputRule(regexp: RegExp, markType: MarkType): InputRule {
  return guardedRule(regexp, (state, match, start, end) => {
    const text = match[1];
    if (!text) {
      return null;
    }
    const mark = markType.create();
    const marked = state.schema.text(text, [mark]);
    const tail = state.schema.text('\u200b');
    let tr = state.tr.delete(start, end);
    tr = tr.insert(start, marked);
    tr = tr.insert(start + text.length, tail);
    const caret = tr.doc.resolve(start + text.length + 1);
    return markCloseHistoryGroup(
      tr.setSelection(TextSelection.near(caret, -1)).setStoredMarks([]),
    );
  });
}

function replaceBlockWithAtom(
  regexp: RegExp,
  create: (blockId: string) => ReturnType<typeof editorSchema.nodes.horizontal_rule.create>,
): InputRule {
  return guardedRule(regexp, (state, _match, start, _end) => {
    const $from = state.doc.resolve(start);
    if ($from.parent.type !== editorSchema.nodes.paragraph) {
      return null;
    }
    const blockId = blockIdAtTextblock(state, start);
    const pos = $from.before();
    const replaced = state.tr.replaceWith(pos, pos + $from.parent.nodeSize, create(blockId));
    return markCloseHistoryGroup(replaced.setSelection(TextSelection.near(replaced.doc.resolve(pos + 1), 1)));
  });
}

function listRule(
  regexp: RegExp,
  listType: NodeType,
  itemType: NodeType,
  itemAttrs: Attrs,
): InputRule {
  return guardedRule(regexp, (state, _match, start, end) => (
    replaceParagraphWithList(state, start, end, listType, itemType, itemAttrs)
  ));
}

export const TYPED_SHORTCUTS_UNBOUND = [
  '$$ → equation block',
  '$...$ → inline equation',
] as const;

export const EDITOR_KEYS_UNBOUND = [
  'Ctrl+K → Link',
  'Ctrl+Shift+V → Paste as plain text',
] as const;

const HEADING_RULES: InputRule[] = [1, 2, 3, 4, 5, 6].map((level) => {
  const hashes = '#'.repeat(level);
  return headingRule(level, new RegExp(`^${hashes}\\s$`));
});

const BLOCK_RULES: InputRule[] = [
  ...HEADING_RULES,
  listRule(/^[-*]\s$/, editorSchema.nodes.bullet_list, editorSchema.nodes.list_item, { level: 0 }),
  listRule(/^1\.\s$/, editorSchema.nodes.ordered_list, editorSchema.nodes.list_item, { level: 0 }),
  listRule(/^\[ \]\s$/, editorSchema.nodes.checklist, editorSchema.nodes.checklist_item, {
    level: 0,
    checked: false,
  }),
  guardedRule(/^>\s$/, (state, _match, start, end) => replaceParagraphWithQuote(state, start, end)),
  guardedRule(/^```$/, (state, _match, start, end) => (
    runTextblockTypeInputRule(state, start, end, editorSchema.nodes.code_block, {
      blockId: blockIdAtTextblock(state, start),
    })
  )),
  replaceBlockWithAtom(/^---$/, (blockId) => editorSchema.nodes.horizontal_rule.create({ blockId })),
];

const INLINE_RULES: InputRule[] = [
  markInputRule(/\*\*((?:[^*]|\*(?!\*))+)\*\*$/, editorSchema.marks.bold),
  markInputRule(/(?<!\*)\*([^*\n]+)\*(?!\*)$/, editorSchema.marks.italic),
  markInputRule(/~~([^~\s](?:[^~]*[^~\s])?)~~$/, editorSchema.marks.strike),
  markInputRule(/`([^`\s](?:[^`]*[^`\s])?)`$/, editorSchema.marks.code),
];

export function typedShortcutInputRulesPlugin() {
  return inputRules({ rules: [...BLOCK_RULES, ...INLINE_RULES] });
}
