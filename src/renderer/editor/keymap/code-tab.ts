import type { Command, EditorState } from 'prosemirror-state';

const TAB = '\t';
const TAB_SPACES = 4;

interface CodeBlock {
  start: number;
  text: string;
}

interface LineSpan {
  start: number;
  end: number;
}

function codeBlock(state: EditorState): CodeBlock | null {
  const { $from, $to } = state.selection;
  if (!$from.sameParent($to) || $from.parent.type.spec.code !== true) {
    return null;
  }
  return { start: $from.start(), text: $from.parent.textContent };
}

function lineSpans(text: string): LineSpan[] {
  const spans: LineSpan[] = [];
  let start = 0;
  for (let index = 0; index <= text.length; index += 1) {
    if (index === text.length || text[index] === '\n') {
      spans.push({ start, end: index });
      start = index + 1;
    }
  }
  return spans;
}

function linesInRange(text: string, from: number, to: number): LineSpan[] {
  return lineSpans(text).filter((line) => {
    if (from === to) {
      return from >= line.start && from <= line.end;
    }
    return to > line.start && from < line.end;
  });
}

function withoutOneIndent(line: string): string {
  if (line.startsWith(TAB)) {
    return line.slice(1);
  }
  let spaces = 0;
  while (spaces < TAB_SPACES && spaces < line.length && line[spaces] === ' ') {
    spaces += 1;
  }
  return line.slice(spaces);
}

function codeTabCommand(outdent: boolean): Command {
  return (state, dispatch) => {
    const block = codeBlock(state);
    if (block === null) {
      return false;
    }
    const from = state.selection.from - block.start;
    const to = state.selection.to - block.start;
    const lines = linesInRange(block.text, from, to);
    if (!outdent && lines.length < 2) {
      if (dispatch) {
        const tr = state.tr.insertText(TAB, state.selection.from, state.selection.to);
        dispatch(tr.scrollIntoView());
      }
      return true;
    }
    let tr = state.tr;
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      const absFrom = block.start + line.start;
      const absTo = block.start + line.end;
      if (outdent) {
        const current = block.text.slice(line.start, line.end);
        const next = withoutOneIndent(current);
        if (next !== current) {
          tr = tr.insertText(next, absFrom, absTo);
        }
      } else {
        tr = tr.insertText(TAB, absFrom);
      }
    }
    if (dispatch) {
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

export function codeBlockKeymap(): Record<string, Command> {
  return {
    Tab: codeTabCommand(false),
    'Shift-Tab': codeTabCommand(true),
  };
}
