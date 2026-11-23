import { TEXT_MAX_CHARS } from '../../shared/schema/limits.js';
import type { BodyInline, ParagraphBlock, TextMarks } from '../../shared/schema/types.js';

export interface MarkState {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
}

export const NO_MARKS: MarkState = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
};

const PARAGRAPH = {
  align: 'left' as const,
  lineSpacing: 'single' as const,
  spaceBefore: 0 as const,
  spaceAfter: 0 as const,
  indents: { left: 0, first: 0, hanging: 0 },
};

export function withMark(marks: MarkState, tag: string): MarkState {
  if (tag === 'b' || tag === 'strong') {
    return { ...marks, bold: true };
  }
  if (tag === 'i' || tag === 'em') {
    return { ...marks, italic: true };
  }
  if (tag === 'u') {
    return { ...marks, underline: true };
  }
  if (tag === 's' || tag === 'strike' || tag === 'del') {
    return { ...marks, strike: true };
  }
  return marks;
}

export function textMarks(marks: MarkState): TextMarks | undefined {
  const result: TextMarks = {};
  if (marks.bold) {
    result.bold = true;
  }
  if (marks.italic) {
    result.italic = true;
  }
  if (marks.underline) {
    result.underline = true;
  }
  if (marks.strike) {
    result.strike = true;
  }
  if (Object.keys(result).length === 0) {
    return undefined;
  }
  return result;
}

export function sameMarks(left: MarkState, right: MarkState): boolean {
  return left.bold === right.bold
    && left.italic === right.italic
    && left.underline === right.underline
    && left.strike === right.strike;
}

/** Drops unpaired surrogates, a BOM, and controls other than tab and newline. */
export function stripUnsafe(value: string): string {
  let out = '';
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0xfeff) {
      continue;
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1) ?? 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += value[index] ?? '';
        out += value[index + 1] ?? '';
        index += 1;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      continue;
    }
    if (code < 0x20 && code !== 0x09 && code !== 0x0a) {
      continue;
    }
    if (code === 0x7f) {
      continue;
    }
    out += value[index] ?? '';
  }
  return out;
}

export function limitText(value: string, max: number): string {
  const chars = [...value];
  if (chars.length <= max) {
    return value;
  }
  return chars.slice(0, max).join('');
}

export function inlineLength(content: readonly BodyInline[]): number {
  let total = 0;
  for (const item of content) {
    if (item.type === 'text' || item.type === 'link') {
      total += [...item.text].length;
    }
  }
  return total;
}

export function limitInlines(content: readonly BodyInline[], max: number): BodyInline[] {
  let used = 0;
  const out: BodyInline[] = [];
  for (const item of content) {
    if (item.type !== 'text' && item.type !== 'link') {
      continue;
    }
    const room = max - used;
    if (room <= 0) {
      break;
    }
    const text = limitText(item.text, room);
    if (text.length === 0) {
      continue;
    }
    used += [...text].length;
    if (item.type === 'link') {
      out.push({ type: 'link', address: item.address, text });
    } else if (item.marks) {
      out.push({ type: 'text', text, marks: item.marks });
    } else {
      out.push({ type: 'text', text });
    }
  }
  return out;
}

export function collapseInline(value: string): string {
  return stripUnsafe(value).replace(/[ \t\r\n\f\v]+/g, ' ');
}

export function paragraphBlock(id: string, content: BodyInline[]): ParagraphBlock {
  return {
    type: 'paragraph',
    id,
    align: PARAGRAPH.align,
    lineSpacing: PARAGRAPH.lineSpacing,
    spaceBefore: PARAGRAPH.spaceBefore,
    spaceAfter: PARAGRAPH.spaceAfter,
    indents: { left: 0, first: 0, hanging: 0 },
    content,
  };
}

export function plainTextBlocks(text: string, ids: () => string, maxBlocks: number): ParagraphBlock[] {
  const cleaned = stripUnsafe(text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
  if (cleaned.length === 0) {
    return [];
  }
  const lines = cleaned.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  const blocks: ParagraphBlock[] = [];
  for (const line of lines) {
    if (blocks.length >= maxBlocks) {
      break;
    }
    const limited = limitText(line, TEXT_MAX_CHARS);
    const content: BodyInline[] = limited.length > 0 ? [{ type: 'text', text: limited }] : [];
    blocks.push(paragraphBlock(ids(), content));
  }
  return blocks;
}
