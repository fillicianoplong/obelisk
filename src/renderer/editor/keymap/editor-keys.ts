import { closeHistory } from 'prosemirror-history';
import { Fragment } from 'prosemirror-model';
import type { Node as ProseNode } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import type { Command, Transaction } from 'prosemirror-state';
import { newBlockId } from '../block-id.js';

/** Backspace at the start of the block after a page break removes the break. */
export function backspacePageBreak(): Command {
  return (state, dispatch) => {
    const { selection } = state;
    if (!selection.empty) {
      return false;
    }
    const { $from } = selection;
    if ($from.depth !== 1 || $from.parentOffset !== 0) {
      return false;
    }
    const index = $from.index(0);
    if (index <= 0) {
      return false;
    }
    const previous = state.doc.child(index - 1);
    if (previous.type.name !== 'page_break') {
      return false;
    }
    const at = $from.before(1);
    if (dispatch) {
      dispatch(state.tr.delete(at - previous.nodeSize, at));
    }
    return true;
  };
}

function renewedAttrs(node: ProseNode, mint: () => string): Record<string, unknown> {
  const attrs: Record<string, unknown> = { ...node.attrs };
  if (typeof attrs.blockId === 'string') {
    attrs.blockId = mint();
  }
  return attrs;
}

function emptyTextBlock(node: ProseNode, mint: () => string, schema: ProseNode['type']['schema']): ProseNode {
  if (node.isTextblock && node.type.isInGroup('block')) {
    return node.type.create(renewedAttrs(node, mint));
  }
  return schema.nodes.paragraph.create({ blockId: mint() });
}

/** Position of the first text offset inside a block, relative to the block's start. */
function textStart(node: ProseNode): number {
  if (node.isTextblock) {
    return 1;
  }
  const first = node.firstChild;
  if (first === null) {
    return 1;
  }
  return 1 + textStart(first);
}

function placeCaret(tr: Transaction, pos: number): Transaction {
  const selection = TextSelection.create(tr.doc, pos);
  return tr.setSelection(selection).scrollIntoView();
}

/**
 * Split the block at the caret, put a page break between the halves, and
 * leave the caret at the start of the second half. At the end of a block the
 * break goes after it and the caret moves into a new empty block. A selection
 * is deleted first, in the same step.
 */
export function insertPageBreakCommand(): Command {
  return (state, dispatch) => {
    const mint = newBlockId;
    let tr = state.tr;
    if (!state.selection.empty) {
      tr = tr.deleteSelection();
    }
    const $from = tr.selection.$from;
    const schema = tr.doc.type.schema;
    const pageBreak = schema.nodes.page_break.create({ blockId: mint() });

    if (!$from.parent.isTextblock) {
      const at = Math.max(0, Math.min($from.pos, tr.doc.content.size));
      const empty = schema.nodes.paragraph.create({ blockId: mint() });
      tr = tr.insert(at, Fragment.from([pageBreak, empty]));
      tr = placeCaret(tr, at + pageBreak.nodeSize + 1);
      if (dispatch) {
        dispatch(closeHistory(tr));
      }
      return true;
    }

    const topFrom = $from.before(1);
    const topTo = $from.after(1);
    let atEnd = $from.parentOffset === $from.parent.content.size;
    for (let depth = $from.depth - 1; atEnd && depth >= 1; depth -= 1) {
      if ($from.index(depth) !== $from.node(depth).childCount - 1) {
        atEnd = false;
      }
    }

    if (atEnd) {
      const empty = emptyTextBlock($from.parent, mint, schema);
      tr = tr.insert(topTo, Fragment.from([pageBreak, empty]));
      tr = placeCaret(tr, topTo + pageBreak.nodeSize + textStart(empty));
      if (dispatch) {
        dispatch(closeHistory(tr));
      }
      return true;
    }

    let left: ProseNode = $from.parent.cut(0, $from.parentOffset);
    let right: ProseNode = $from.parent.type.create(
      renewedAttrs($from.parent, mint),
      $from.parent.content.cut($from.parentOffset),
    );
    for (let depth = $from.depth - 1; depth >= 1; depth -= 1) {
      const ancestor = $from.node(depth);
      const index = $from.index(depth);
      const leftChildren: ProseNode[] = [];
      for (let child = 0; child < index; child += 1) {
        leftChildren.push(ancestor.child(child));
      }
      leftChildren.push(left);
      const rightChildren: ProseNode[] = [right];
      for (let child = index + 1; child < ancestor.childCount; child += 1) {
        rightChildren.push(ancestor.child(child));
      }
      left = ancestor.copy(Fragment.from(leftChildren));
      right = ancestor.type.create(renewedAttrs(ancestor, mint), Fragment.from(rightChildren));
    }

    tr = tr.replaceWith(topFrom, topTo, [left, pageBreak, right]);
    const caret = topFrom + left.nodeSize + pageBreak.nodeSize + textStart(right);
    tr = placeCaret(tr, caret);
    if (dispatch) {
      dispatch(closeHistory(tr));
    }
    return true;
  };
}

export function editorKeysKeymap(): Record<string, Command> {
  return {
    'Mod-Enter': insertPageBreakCommand(),
  };
}
