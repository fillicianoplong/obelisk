import type { DocumentMessage, JsonObject, JsonValue } from '../../../shared/ipc/types.js';

// Paragraph text is what this editor can show. Other blocks stay in the file
// until a paragraph changes, and then the paragraph text is what gets saved.

const BLOCK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function newBlockId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function inlineText(content: JsonValue | undefined): string {
  if (!Array.isArray(content)) {
    return '';
  }
  let text = '';
  for (const part of content) {
    if (typeof part !== 'object' || part === null || Array.isArray(part)) {
      continue;
    }
    const record = part as { type?: JsonValue; text?: JsonValue };
    if ((record.type === 'text' || record.type === 'link') && typeof record.text === 'string') {
      text += record.text;
    }
  }
  return text;
}

export function visibleParagraphTexts(document: DocumentMessage): string[] {
  const texts: string[] = [];
  for (const block of document.blocks) {
    if (block.type !== 'paragraph') {
      continue;
    }
    texts.push(inlineText(block.content));
  }
  return texts;
}

function paragraphId(block: JsonObject): string | null {
  return typeof block.id === 'string' && BLOCK_ID.test(block.id) ? block.id : null;
}

export function paragraphIds(document: DocumentMessage): string[] {
  const ids: string[] = [];
  for (const block of document.blocks) {
    if (block.type !== 'paragraph') {
      continue;
    }
    const id = paragraphId(block);
    if (id !== null) {
      ids.push(id);
    }
  }
  return ids;
}

function headerFields(id: string): JsonObject {
  return {
    id,
    align: 'left',
    lineSpacing: 'single',
    spaceBefore: 0,
    spaceAfter: 0,
    indents: { left: 0, first: 0, hanging: 0 },
    content: [],
  };
}

function paragraphBlock(id: string, text: string): JsonObject {
  return {
    type: 'paragraph',
    ...headerFields(id),
    content: text.length === 0 ? [] : [{ type: 'text', text }],
  };
}

export function createBaseDocument(mint: () => string = newBlockId): {
  document: DocumentMessage;
  blockIds: string[];
} {
  const paragraph = mint();
  return {
    document: {
      view: 'pages',
      page: {
        paper: 'letter',
        orientation: 'portrait',
        margins: { top: 1, right: 1, bottom: 1, left: 1 },
      },
      header: headerFields(mint()),
      footer: headerFields(mint()),
      blocks: [paragraphBlock(paragraph, '')],
    },
    blockIds: [paragraph],
  };
}

function sameTexts(left: readonly string[], right: readonly string[]): boolean {
  if (left.length === right.length && left.every((text, index) => text === right[index])) {
    return true;
  }
  // The editor shows one empty paragraph when the file has none.
  return left.length === 0 && right.length === 1 && right[0] === '';
}

function withText(block: JsonObject, text: string): JsonObject {
  if (inlineText(block.content) === text) {
    return block;
  }
  return {
    ...block,
    content: text.length === 0 ? [] : [{ type: 'text', text }],
  };
}

// An unedited tab keeps the document that was opened. An edit updates paragraph
// text and leaves every other block in place.
export function documentFromEditor(
  base: DocumentMessage,
  paragraphs: readonly string[],
  mint: () => string = newBlockId,
): { document: DocumentMessage; blockIds: string[] } {
  if (sameTexts(visibleParagraphTexts(base), paragraphs)) {
    return { document: base, blockIds: paragraphIds(base) };
  }
  const blocks: JsonObject[] = [];
  const ids: string[] = [];
  let index = 0;
  for (const block of base.blocks) {
    if (block.type !== 'paragraph') {
      blocks.push(block);
      continue;
    }
    if (index >= paragraphs.length) {
      continue;
    }
    const text = paragraphs[index] ?? '';
    const id = paragraphId(block) ?? mint();
    const next = withText({ ...block, id }, text);
    blocks.push(next);
    ids.push(id);
    index += 1;
  }
  while (index < paragraphs.length) {
    const id = mint();
    blocks.push(paragraphBlock(id, paragraphs[index] ?? ''));
    ids.push(id);
    index += 1;
  }
  return {
    document: {
      view: base.view,
      page: base.page,
      header: base.header,
      footer: base.footer,
      blocks,
    },
    blockIds: ids,
  };
}
