import type { ReactNode } from 'react';
import type { JsonObject } from '../../../shared/ipc/types.js';
import { pageFieldText, type PageFieldFormat, type PageFieldKind } from './page-field.js';

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function markWrap(text: string, marks: JsonObject | undefined, key: string) {
  let node: ReactNode = text;
  if (!marks) {
    return <span key={key}>{node}</span>;
  }
  if (marks.code === true) {
    node = <code className="inline-code">{node}</code>;
  }
  if (marks.bold === true) {
    node = <strong>{node}</strong>;
  }
  if (marks.italic === true) {
    node = <em>{node}</em>;
  }
  if (marks.strike === true) {
    node = <s>{node}</s>;
  }
  if (marks.underline === true) {
    node = <span data-underline="true">{node}</span>;
  }
  if (marks.superscript === true) {
    node = <sup>{node}</sup>;
  }
  if (marks.subscript === true) {
    node = <sub>{node}</sub>;
  }
  const attrs: Record<string, string> = {};
  if (typeof marks.font === 'string') {
    attrs['data-font-family'] = marks.font;
  }
  if (typeof marks.size === 'number') {
    attrs['data-font-size'] = String(marks.size);
  }
  const style: Record<string, string> = {};
  if (typeof marks.color === 'string') {
    style.color = marks.color;
  }
  if (typeof marks.highlight === 'string') {
    style.background = marks.highlight;
  }
  return (
    <span key={key} {...attrs} style={Object.keys(style).length > 0 ? style : undefined}>
      {node}
    </span>
  );
}

export function HeaderText({
  paragraph,
  page,
  total,
}: {
  paragraph: JsonObject;
  page: number;
  total: number;
}) {
  const items = Array.isArray(paragraph.content) ? paragraph.content : [];
  return (
    <p
      data-align={typeof paragraph.align === 'string' ? paragraph.align : 'left'}
      data-line-spacing={typeof paragraph.lineSpacing === 'string' ? paragraph.lineSpacing : 'single'}
    >
      {items.map((raw, index) => {
        if (!isRecord(raw)) {
          return null;
        }
        if (raw.type === 'pageField') {
          const kind: PageFieldKind = raw.kind === 'pages' ? 'pages' : 'page';
          const format: PageFieldFormat = raw.format === 'roman' || raw.format === 'page-of-n' ? raw.format : 'decimal';
          return (
            <span
              key={index}
              className="page-field"
              data-page-field={kind}
              data-page-format={format}
            >
              {pageFieldText(kind, format, page, total)}
            </span>
          );
        }
        if (raw.type === 'text' && typeof raw.text === 'string') {
          return markWrap(raw.text, isRecord(raw.marks) ? raw.marks : undefined, String(index));
        }
        return null;
      })}
    </p>
  );
}
