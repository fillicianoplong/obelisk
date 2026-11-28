import type { Node as ProseNode } from 'prosemirror-model';
import type { Command, EditorState } from 'prosemirror-state';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import {
  formatDateTime,
  isRealDateTime,
  nowLocalDateTime,
  type DateChipFormat,
} from '../../../shared/date-time/format.js';
import { markCloseHistoryGroup } from '../history/groups.js';

export interface DateTimeDraft {
  mode: 'insert' | 'edit' | 'format';
  dateTime: string;
  format: DateChipFormat;
}

export interface DateChipSpan {
  from: number;
  to: number;
  dateTime: string;
  format: DateChipFormat;
}

const DEFAULT_FORMAT: DateChipFormat = 'windows-short';

function dateChipType(state: EditorState) {
  return state.schema.nodes.date_chip;
}

export function dateChipAt(state: EditorState): DateChipSpan | null {
  const type = dateChipType(state);
  if (type === undefined) {
    return null;
  }
  const { selection } = state;
  if (selection instanceof NodeSelection && selection.node.type === type) {
    return chipSpan(selection.from, selection.node);
  }
  const { $from } = selection;
  if (!$from.parent.isTextblock) {
    return null;
  }
  const nodeBefore = $from.nodeBefore;
  if (nodeBefore?.type === type && selection.empty && $from.parentOffset > 0) {
    return chipSpan($from.pos - nodeBefore.nodeSize, nodeBefore);
  }
  const nodeAfter = $from.nodeAfter;
  if (nodeAfter?.type === type && selection.empty) {
    return chipSpan($from.pos, nodeAfter);
  }
  if (!selection.empty) {
    let found: DateChipSpan | null = null;
    state.doc.nodesBetween(selection.from, selection.to, (node, pos) => {
      if (found !== null || node.type !== type) {
        return found === null;
      }
      found = chipSpan(pos, node);
      return false;
    });
    return found;
  }
  return null;
}

function chipSpan(from: number, node: ProseNode): DateChipSpan {
  return {
    from,
    to: from + node.nodeSize,
    dateTime: String(node.attrs.dateTime),
    format: String(node.attrs.format) as DateChipFormat,
  };
}

export function dateTimeInsertTarget(state: EditorState): { from: number; to: number } | null {
  if (dateChipType(state) === undefined) {
    return null;
  }
  const { from, to } = state.selection;
  const $from = state.doc.resolve(from);
  const $to = state.doc.resolve(to);
  if (!$from.sameParent($to) || !$from.parent.isTextblock) {
    return null;
  }
  return { from, to };
}

export function dateTimeDraftFromState(state: EditorState): DateTimeDraft | null {
  const chip = dateChipAt(state);
  if (chip !== null) {
    return {
      mode: 'edit',
      dateTime: chip.dateTime,
      format: chip.format,
    };
  }
  if (dateTimeInsertTarget(state) === null) {
    return null;
  }
  return {
    mode: 'insert',
    dateTime: nowLocalDateTime(),
    format: DEFAULT_FORMAT,
  };
}

export function dateTimeFormatDraftFromState(state: EditorState): DateTimeDraft | null {
  const chip = dateChipAt(state);
  if (chip === null) {
    return null;
  }
  return {
    mode: 'format',
    dateTime: chip.dateTime,
    format: chip.format,
  };
}

export function applyDateTimeChipCommand(dateTime: string, format: DateChipFormat, mode: DateTimeDraft['mode']): Command {
  return (state, dispatch) => {
    if (!isRealDateTime(dateTime)) {
      return false;
    }
    const type = dateChipType(state);
    if (type === undefined) {
      return false;
    }
    const chip = dateChipAt(state);
    let tr = state.tr;
    if (mode === 'format' && chip !== null) {
      tr = tr.setNodeMarkup(chip.from, undefined, { dateTime: chip.dateTime, format });
      tr = tr.setSelection(NodeSelection.create(tr.doc, chip.from));
    } else if ((mode === 'edit') && chip !== null) {
      const node = type.create({ dateTime, format });
      tr = tr.replaceWith(chip.from, chip.to, node);
      tr = tr.setSelection(NodeSelection.create(tr.doc, chip.from));
    } else if (mode === 'insert') {
      const target = dateTimeInsertTarget(state);
      if (target === null) {
        return false;
      }
      const node = type.create({ dateTime, format });
      tr = tr.replaceWith(target.from, target.to, node);
      tr = tr.setSelection(NodeSelection.create(tr.doc, target.from));
    } else {
      return false;
    }
    tr = markCloseHistoryGroup(tr);
    if (dispatch) {
      dispatch(tr);
    }
    return true;
  };
}

export function convertDateTimeToTextCommand(): Command {
  return (state, dispatch) => {
    const chip = dateChipAt(state);
    if (chip === null) {
      return false;
    }
    const text = formatDateTime(chip.dateTime, chip.format);
    if (text.length === 0) {
      return false;
    }
    const replacement = state.schema.text(text);
    let tr = state.tr.replaceWith(chip.from, chip.to, replacement);
    const caret = Math.min(chip.from + text.length, tr.doc.content.size);
    tr = tr.setSelection(TextSelection.create(tr.doc, caret));
    if (dispatch) {
      dispatch(markCloseHistoryGroup(tr));
    }
    return true;
  };
}

export function removeDateTimeChipCommand(): Command {
  return (state, dispatch) => {
    const chip = dateChipAt(state);
    if (chip === null) {
      return false;
    }
    let tr = state.tr.delete(chip.from, chip.to);
    tr = tr.setSelection(TextSelection.create(tr.doc, chip.from));
    if (dispatch) {
      dispatch(markCloseHistoryGroup(tr));
    }
    return true;
  };
}

export function dateTimeMenuCommand(menuId: string): Command | null {
  if (menuId === 'insert-date-time') {
    return (state) => dateTimeDraftFromState(state) !== null;
  }
  if (menuId === 'date-time-edit') {
    return (state) => dateChipAt(state) !== null;
  }
  if (menuId === 'date-time-format') {
    return (state) => dateTimeFormatDraftFromState(state) !== null;
  }
  if (menuId === 'date-time-convert') {
    return convertDateTimeToTextCommand();
  }
  if (menuId === 'date-time-remove') {
    return removeDateTimeChipCommand();
  }
  return null;
}