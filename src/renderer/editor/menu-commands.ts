import { redo, undo } from 'prosemirror-history';
import { AllSelection } from 'prosemirror-state';
import type { Command, EditorState } from 'prosemirror-state';
import { insertTextBlock } from './block-commands.js';
import type { TextBlockKind } from './schema/index.js';
import { newBlockId } from './block-id.js';
import { caretBlockIndex } from './block-handle-plugin.js';
import {
  deleteSelectedBlocksCommand,
  duplicateBlocksCommand,
  moveBlocksDownCommand,
  moveBlocksUpCommand,
} from './block-move-commands.js';
import { formatMenuCommand } from './format-commands.js';
import { insertPageBreakCommand } from './keymap/editor-keys.js';

const INSERT_KIND: Record<string, { kind: TextBlockKind; level?: number } | null> = {
  'insert-text': { kind: 'paragraph' },
  'insert-heading-1': { kind: 'heading', level: 1 },
  'insert-heading-2': { kind: 'heading', level: 2 },
  'insert-heading-3': { kind: 'heading', level: 3 },
  'insert-bulleted': { kind: 'bulleted-list' },
  'insert-numbered': { kind: 'numbered-list' },
  'insert-checklist': { kind: 'checklist' },
  'insert-quote': { kind: 'quote' },
  'insert-code': { kind: 'code' },
  'insert-horizontal': { kind: 'divider' },
  'insert-page-break': { kind: 'page-break' },
  'insert-columns': null,
  'insert-table': null,
  'insert-image': null,
  'insert-equation': null,
  'insert-diagram': null,
  'insert-drawing': null,
  'insert-signature': null,
  'insert-date-time': null,
  'insert-link': null,
};

export function editorMenuCommand(menuId: string): Command | null {
  if (menuId === 'edit-undo') {
    return undo;
  }
  if (menuId === 'edit-redo') {
    return redo;
  }
  if (menuId === 'edit-select-all') {
    return (state, dispatch) => {
      const tr = state.tr.setSelection(new AllSelection(state.doc));
      if (dispatch) {
        dispatch(tr);
      }
      return true;
    };
  }
  if (menuId === 'edit-duplicate') {
    return duplicateBlocksCommand();
  }
  if (menuId === 'block-delete') {
    return deleteSelectedBlocksCommand();
  }
  if (menuId === 'block-move-up') {
    return moveBlocksUpCommand();
  }
  if (menuId === 'block-move-down') {
    return moveBlocksDownCommand();
  }
  if (menuId === 'insert-page-break') {
    return insertPageBreakCommand();
  }
  const insert = INSERT_KIND[menuId];
  if (insert !== undefined) {
    if (insert === null) {
      return null;
    }
    return (state, dispatch) => {
      const index = caretBlockIndex(state);
      const tr = insertTextBlock(state.tr, insert.kind, newBlockId, {
        after: index,
        level: insert.level,
      });
      if (dispatch) {
        dispatch(tr);
      }
      return true;
    };
  }
  return formatMenuCommand(menuId);
}

export function editorMenuCommandEnabled(state: EditorState, menuId: string): boolean {
  const command = editorMenuCommand(menuId);
  if (command === null) {
    return false;
  }
  return command(state);
}