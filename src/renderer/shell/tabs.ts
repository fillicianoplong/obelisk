import type { EditorState } from 'prosemirror-state';
import { createTabEditorState } from '../editor/state.js';

export interface PageTab {
  id: string;
  title: string;
  editor: EditorState;
}

export function untitledTitle(number: number): string {
  return `Untitled ${number}`;
}

export function createTab(number: number): PageTab {
  return {
    id: `untitled-${number}`,
    title: untitledTitle(number),
    editor: createTabEditorState(),
  };
}
