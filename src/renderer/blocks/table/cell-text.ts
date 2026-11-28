import type { BodyInline, TableCell } from '../../../shared/schema/types.js';

export function cellPlainText(cell: TableCell): string {
  if (cell.kind === 'formula') {
    return cell.source;
  }
  let text = '';
  for (const part of cell.content) {
    if (part.type === 'text' || part.type === 'link') {
      text += part.text;
    }
  }
  return text;
}

export function textCellFromPlain(text: string): TableCell {
  const trimmed = text;
  if (trimmed.length > 0 && trimmed.startsWith('=')) {
    return { kind: 'formula', source: trimmed };
  }
  if (trimmed.length === 0) {
    return { kind: 'text', content: [] };
  }
  return { kind: 'text', content: [{ type: 'text', text: trimmed }] };
}

export function textCellFromInlines(content: BodyInline[]): TableCell {
  return { kind: 'text', content: content.slice() };
}