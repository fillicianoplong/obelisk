import type { Node as ProseNode } from 'prosemirror-model';
import type { JsonObject } from '../../../shared/ipc/types.js';
import { jsonMarksFromPm, textNodeFromRun } from '../schema/inline-json.js';
import type { TextMarks } from '../../../shared/schema/types.js';
import type { PageFieldFormat, PageFieldKind } from './page-field.js';
import { headerSchema } from './schema.js';

function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fieldKind(value: unknown): PageFieldKind {
  return value === 'pages' ? 'pages' : 'page';
}

function fieldFormat(value: unknown): PageFieldFormat {
  if (value === 'roman' || value === 'page-of-n') {
    return value;
  }
  return 'decimal';
}

export function headerDocFromParagraph(paragraph: JsonObject): ProseNode {
  const indents = isRecord(paragraph.indents) ? paragraph.indents : {};
  const content: ProseNode[] = [];
  const items = Array.isArray(paragraph.content) ? paragraph.content : [];
  for (const raw of items) {
    if (!isRecord(raw)) {
      continue;
    }
    if (raw.type === 'text' && typeof raw.text === 'string' && raw.text.length > 0) {
      content.push(textNodeFromRun(raw.text, raw.marks as TextMarks | undefined, headerSchema));
      continue;
    }
    if (raw.type === 'pageField') {
      content.push(headerSchema.nodes.page_field.create({
        kind: fieldKind(raw.kind),
        format: fieldFormat(raw.format),
      }));
    }
  }
  const paragraphNode = headerSchema.nodes.paragraph.create({
    blockId: typeof paragraph.id === 'string' ? paragraph.id : '',
    align: typeof paragraph.align === 'string' ? paragraph.align : 'left',
    lineSpacing: typeof paragraph.lineSpacing === 'string' ? paragraph.lineSpacing : 'single',
    spaceBefore: typeof paragraph.spaceBefore === 'number' ? paragraph.spaceBefore : 0,
    spaceAfter: typeof paragraph.spaceAfter === 'number' ? paragraph.spaceAfter : 0,
    indentLeft: typeof indents.left === 'number' ? indents.left : 0,
    indentFirst: typeof indents.first === 'number' ? indents.first : 0,
    indentHanging: typeof indents.hanging === 'number' ? indents.hanging : 0,
  }, content);
  return headerSchema.nodes.doc.create(null, paragraphNode);
}

export function paragraphFromHeaderDoc(doc: ProseNode, previous: JsonObject): JsonObject {
  const paragraph = doc.firstChild;
  if (paragraph === null) {
    return previous;
  }
  const content: JsonObject[] = [];
  paragraph.forEach((node) => {
    if (node.isText) {
      const marks = jsonMarksFromPm(node.marks);
      const run: JsonObject = { type: 'text', text: node.text ?? '' };
      if (marks !== undefined) {
        run.marks = marks as unknown as JsonObject;
      }
      content.push(run);
      return;
    }
    if (node.type.name === 'page_field') {
      content.push({
        type: 'pageField',
        kind: fieldKind(node.attrs.kind),
        format: fieldFormat(node.attrs.format),
      });
    }
  });
  return {
    id: typeof paragraph.attrs.blockId === 'string' && paragraph.attrs.blockId.length > 0
      ? paragraph.attrs.blockId
      : previous.id,
    align: paragraph.attrs.align,
    lineSpacing: paragraph.attrs.lineSpacing,
    spaceBefore: paragraph.attrs.spaceBefore,
    spaceAfter: paragraph.attrs.spaceAfter,
    indents: {
      left: paragraph.attrs.indentLeft,
      first: paragraph.attrs.indentFirst,
      hanging: paragraph.attrs.indentHanging,
    },
    content,
  };
}

export function headerHasContent(paragraph: JsonObject): boolean {
  return Array.isArray(paragraph.content) && paragraph.content.length > 0;
}
