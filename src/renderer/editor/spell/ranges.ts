import type { Node as ProseNode } from 'prosemirror-model';
import { tokenizeText } from './tokenize.js';

export interface SpellSpan {
  from: number;
  to: number;
  word: string;
}

interface CharPos {
  ch: string;
  pos: number;
}

function charsOf(block: ProseNode, blockPos: number): CharPos[] {
  const chars: CharPos[] = [];
  block.descendants((child, childPos) => {
    if (child.isText && child.text != null) {
      if (child.marks.some((mark) => mark.type.name === 'code')) {
        chars.push({ ch: '\n', pos: -1 });
        return;
      }
      for (let index = 0; index < child.text.length; index += 1) {
        chars.push({ ch: child.text[index] ?? '', pos: blockPos + 1 + childPos + index });
      }
      return;
    }
    if (child.isLeaf) {
      chars.push({ ch: '\n', pos: -1 });
    }
  });
  return chars;
}

function blockSpans(block: ProseNode, blockPos: number): SpellSpan[] {
  const chars = charsOf(block, blockPos);
  const text = chars.map((entry) => entry.ch).join('');
  const spans: SpellSpan[] = [];
  for (const token of tokenizeText(text)) {
    if (token.skip !== null) {
      continue;
    }
    const start = chars[token.from];
    const end = chars[token.to - 1];
    if (start === undefined || end === undefined || start.pos < 0 || end.pos < 0) {
      continue;
    }
    spans.push({ from: start.pos, to: end.pos + 1, word: token.word });
  }
  return spans;
}

export function wordSpans(doc: ProseNode): SpellSpan[] {
  const spans: SpellSpan[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) {
      return;
    }
    if (node.type.spec.code === true) {
      return false;
    }
    spans.push(...blockSpans(node, pos));
    return false;
  });
  return spans;
}

function containsCaret(span: SpellSpan, caret: number): boolean {
  return caret > span.from && caret <= span.to;
}

export function spellingSpans(
  doc: ProseNode,
  caret: number | null,
  misspelled: (word: string) => boolean,
): SpellSpan[] {
  const spans: SpellSpan[] = [];
  for (const span of wordSpans(doc)) {
    if (caret !== null && containsCaret(span, caret)) {
      continue;
    }
    if (misspelled(span.word)) {
      spans.push(span);
    }
  }
  return spans;
}

export function spanAt(spans: readonly SpellSpan[], pos: number): SpellSpan | null {
  for (const span of spans) {
    if (pos >= span.from && pos < span.to) {
      return span;
    }
  }
  for (const span of spans) {
    if (pos === span.to) {
      return span;
    }
  }
  return null;
}
