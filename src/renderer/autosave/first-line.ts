import type { EditorState } from 'prosemirror-state';

const FIRST_LINE_MAX = 80;

export function firstLineFromEditor(editor: EditorState): string {
  const text = editor.doc.textContent.replace(/\s+/g, ' ').trim();
  if (text.length === 0) {
    return '';
  }
  return text.length > FIRST_LINE_MAX ? text.slice(0, FIRST_LINE_MAX) : text;
}