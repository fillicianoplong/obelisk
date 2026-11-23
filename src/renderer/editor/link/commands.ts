import type { Mark, MarkType, Node as ProseNode } from 'prosemirror-model';
import type { Command, EditorState } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import { classifyLinkAddress } from '../../../shared/links/address.js';
import { markCloseHistoryGroup } from '../history/groups.js';

export interface LinkSpan {
  from: number;
  to: number;
  address: string;
  text: string;
}

export interface LinkDraft {
  mode: 'insert' | 'edit';
  text: string;
  address: string;
}

function linkType(state: EditorState): MarkType {
  return state.schema.marks.link;
}

function allowedAddress(marks: readonly Mark[], type: MarkType): string | null {
  const mark = type.isInSet(marks);
  if (mark === undefined || mark === null || typeof mark.attrs.address !== 'string') {
    return null;
  }
  const checked = classifyLinkAddress(mark.attrs.address);
  return checked.ok ? mark.attrs.address : null;
}

function linkRuns(parent: ProseNode, parentPos: number, type: MarkType): LinkSpan[] {
  const runs: LinkSpan[] = [];
  let cursor = parentPos;
  parent.forEach((node) => {
    const start = cursor;
    const end = cursor + node.nodeSize;
    cursor = end;
    if (!node.isText) {
      return;
    }
    const address = allowedAddress(node.marks, type);
    if (address === null) {
      return;
    }
    const previous = runs.at(-1);
    if (previous && previous.address === address && previous.to === start) {
      previous.to = end;
      previous.text += node.text ?? '';
      return;
    }
    runs.push({ from: start, to: end, address, text: node.text ?? '' });
  });
  return runs;
}

export function linkAround(state: EditorState): LinkSpan | null {
  const type = linkType(state);
  if (type === undefined) {
    return null;
  }
  const { from, to } = state.selection;
  const $from = state.doc.resolve(from);
  const $to = state.doc.resolve(to);
  if (!$from.sameParent($to) || !$from.parent.isTextblock) {
    return null;
  }
  const runs = linkRuns($from.parent, $from.start(), type);
  if (from === to) {
    return runs.find((run) => from > run.from && from < run.to)
      ?? runs.find((run) => from === run.to)
      ?? runs.find((run) => from === run.from)
      ?? null;
  }
  return runs.find((run) => from >= run.from && to <= run.to) ?? null;
}

export function linkTarget(state: EditorState): { from: number; to: number } | null {
  const { from, to } = state.selection;
  const $from = state.doc.resolve(from);
  const $to = state.doc.resolve(to);
  if (!$from.sameParent($to) || !$from.parent.isTextblock) {
    return null;
  }
  const type = linkType(state);
  if (type === undefined || !$from.parent.type.allowsMarkType(type)) {
    return null;
  }
  return { from, to };
}

export function linkDraftFromState(state: EditorState): LinkDraft | null {
  const link = linkAround(state);
  const { from, to } = state.selection;
  if (link !== null && from >= link.from && to <= link.to) {
    return { mode: 'edit', text: link.text, address: link.address };
  }
  const target = linkTarget(state);
  if (target === null) {
    return null;
  }
  return {
    mode: 'insert',
    text: state.doc.textBetween(target.from, target.to),
    address: '',
  };
}

export function applyLinkCommand(text: string, address: string): Command {
  return (state, dispatch) => {
    const checked = classifyLinkAddress(address);
    if (!checked.ok) {
      return false;
    }
    const { from, to } = state.selection;
    const link = linkAround(state);
    const editing = link !== null && from >= link.from && to <= link.to;
    const range = editing ? { from: link.from, to: link.to } : linkTarget(state);
    if (range === null) {
      return false;
    }
    const display = text.length > 0 ? text : checked.href;
    if (display.length === 0) {
      return false;
    }
    const mark = linkType(state).create({ address: checked.address });
    let tr = state.tr.replaceWith(range.from, range.to, state.schema.text(display, [mark]));
    const caret = Math.min(range.from + display.length, tr.doc.content.size);
    tr = tr.setSelection(TextSelection.create(tr.doc, caret));
    tr = markCloseHistoryGroup(tr.setStoredMarks([]));
    if (dispatch) {
      dispatch(tr);
    }
    return true;
  };
}

export function removeLinkCommand(): Command {
  return (state, dispatch) => {
    const link = linkAround(state);
    if (link === null) {
      return false;
    }
    if (dispatch) {
      const tr = state.tr.removeMark(link.from, link.to, linkType(state));
      dispatch(markCloseHistoryGroup(tr));
    }
    return true;
  };
}

export function linkMenuCommand(menuId: string): Command | null {
  if (menuId === 'insert-link') {
    return (state) => linkDraftFromState(state) !== null;
  }
  if (menuId === 'link-open' || menuId === 'link-edit') {
    return (state) => linkAround(state) !== null;
  }
  if (menuId === 'link-remove') {
    return removeLinkCommand();
  }
  return null;
}
