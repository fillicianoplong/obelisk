import type { NodeType } from 'prosemirror-model';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import { canSplit } from 'prosemirror-transform';
import { createTextBlockNode } from '../block-commands.js';
import { newBlockId } from '../block-id.js';
import { editorSchema } from '../schema/index.js';
import { markCloseHistoryGroup } from '../history/groups.js';

interface ListItemContext {
  itemDepth: number;
  listDepth: number;
  itemType: NodeType;
  itemAttrs: Record<string, unknown>;
}

function listItemContext(state: EditorState): ListItemContext | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const name = $from.node(depth).type.name;
    if (name === 'list_item' || name === 'checklist_item') {
      return {
        itemDepth: depth,
        listDepth: depth - 1,
        itemType: $from.node(depth).type,
        itemAttrs: { ...$from.node(depth).attrs },
      };
    }
  }
  return null;
}

function emptyListItem(state: EditorState, ctx: ListItemContext): boolean {
  return state.selection.$from.node(ctx.itemDepth).content.size === 0;
}

function insertParagraphAfterBlock(tr: Transaction, blockIndex: number): Transaction {
  let pos = 0;
  for (let index = 0; index <= blockIndex; index += 1) {
    pos += tr.doc.child(index).nodeSize;
  }
  const paragraph = createTextBlockNode('paragraph', editorSchema, newBlockId, {});
  const inserted = tr.insert(pos, paragraph);
  return inserted.setSelection(TextSelection.near(inserted.doc.resolve(pos + 1)));
}

function exitEmptyListItem(state: EditorState, ctx: ListItemContext): Transaction {
  const { $from } = state.selection;
  const level = Number(ctx.itemAttrs.level ?? 0);
  if (level > 0) {
    const itemPos = $from.before(ctx.itemDepth);
    return markCloseHistoryGroup(
      state.tr.setNodeMarkup(itemPos, undefined, { ...ctx.itemAttrs, level: level - 1 }),
    );
  }
  const blockIndex = $from.index(0);
  const list = $from.node(ctx.listDepth);
  const listPos = $from.before(ctx.listDepth);
  if (list.childCount === 1) {
    const paragraph = createTextBlockNode('paragraph', editorSchema, newBlockId, {});
    const tr = state.tr.replaceWith(listPos, listPos + list.nodeSize, paragraph);
    return markCloseHistoryGroup(tr.setSelection(TextSelection.near(tr.doc.resolve(listPos + 1))));
  }
  const itemPos = $from.before(ctx.itemDepth);
  const itemEnd = $from.after(ctx.itemDepth);
  let tr = state.tr.delete(itemPos, itemEnd);
  tr = insertParagraphAfterBlock(tr, blockIndex);
  return markCloseHistoryGroup(tr);
}

function replaceSingleItemListWithParagraph(state: EditorState, ctx: ListItemContext): Transaction | null {
  const { $from } = state.selection;
  const list = $from.node(ctx.listDepth);
  const listPos = $from.before(ctx.listDepth);
  if (list.childCount !== 1) {
    return null;
  }
  const paragraph = createTextBlockNode('paragraph', editorSchema, newBlockId, {});
  const tr = state.tr.replaceWith(listPos, listPos + list.nodeSize, paragraph);
  return markCloseHistoryGroup(tr.setSelection(TextSelection.near(tr.doc.resolve(listPos + 1))));
}

export function listEnterCommand(): Command {
  return (state, dispatch) => {
    const ctx = listItemContext(state);
    if (ctx === null) {
      return false;
    }
    if (emptyListItem(state, ctx)) {
      if (dispatch) {
        dispatch(exitEmptyListItem(state, ctx));
      }
      return true;
    }
    const { $from } = state.selection;
    const splitDepth = ctx.itemDepth + 1;
    const typesAfter = [{ type: ctx.itemType, attrs: ctx.itemAttrs }];
    if (!canSplit(state.doc, $from.pos, splitDepth, typesAfter)) {
      return false;
    }
    const tr = markCloseHistoryGroup(
      state.tr
        .split($from.pos, splitDepth, typesAfter)
        .setStoredMarks([]),
    );
    if (dispatch) {
      dispatch(tr);
    }
    return true;
  };
}

export function listBackspaceAtStartCommand(): Command {
  return (state, dispatch) => {
    const ctx = listItemContext(state);
    if (ctx === null) {
      return false;
    }
    const { $from, empty } = state.selection;
    if (!empty || $from.parentOffset !== 0) {
      return false;
    }
    if (!emptyListItem(state, ctx)) {
      return false;
    }
    const level = Number(ctx.itemAttrs.level ?? 0);
    if (level > 0) {
      const itemPos = $from.before(ctx.itemDepth);
      const tr = markCloseHistoryGroup(
        state.tr.setNodeMarkup(itemPos, undefined, { ...ctx.itemAttrs, level: level - 1 }),
      );
      if (dispatch) {
        dispatch(tr);
      }
      return true;
    }
    if ($from.index(ctx.itemDepth) !== 0) {
      return false;
    }
    const tr = replaceSingleItemListWithParagraph(state, ctx);
    if (tr === null) {
      return false;
    }
    if (dispatch) {
      dispatch(tr);
    }
    return true;
  };
}

export function listEditingKeymap(): Record<string, Command> {
  return {
    Enter: listEnterCommand(),
    Backspace: listBackspaceAtStartCommand(),
  };
}
