import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorState, Transaction } from 'prosemirror-state';

export interface TableCellAddress {
  blockIndex: number;
  row: number;
  col: number;
}

export interface TableSelectionState {
  active: TableCellAddress | null;
}

export const tableSelectionKey = new PluginKey<TableSelectionState>('tableSelection');

export function tableSelectionState(state: EditorState): TableSelectionState {
  return tableSelectionKey.getState(state) ?? { active: null };
}

export function setTableSelection(
  tr: Transaction,
  active: TableCellAddress | null,
): Transaction {
  return tr.setMeta(tableSelectionKey, { active });
}

export function tableSelectionPlugin(): Plugin {
  return new Plugin({
    key: tableSelectionKey,
    state: {
      init: (): TableSelectionState => ({ active: null }),
      apply(tr, value: TableSelectionState): TableSelectionState {
        const meta = tr.getMeta(tableSelectionKey) as { active: TableCellAddress | null } | undefined;
        if (meta !== undefined) {
          return { active: meta.active };
        }
        if (tr.docChanged) {
          return { active: null };
        }
        return value;
      },
    },
  });
}