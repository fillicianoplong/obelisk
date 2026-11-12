import type { Node as ProseNode } from 'prosemirror-model';
import type { DocumentMessage, JsonObject } from '../../../shared/ipc/types.js';
import {
  documentFromEditorDoc,
  visibleParagraphTexts,
} from '../../editor/schema/mapping.js';
import { isBlockId, newBlockId } from '../../editor/block-id.js';

export {
  blockIdsFromDocument,
  visibleParagraphTexts,
} from '../../editor/schema/mapping.js';
export { newBlockId } from '../../editor/block-id.js';

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

export function paragraphIds(document: DocumentMessage): string[] {
  const ids: string[] = [];
  for (const block of document.blocks) {
    if (block.type !== 'paragraph') {
      continue;
    }
    const id = typeof block.id === 'string' && isBlockId(block.id) ? block.id : null;
    if (id !== null) {
      ids.push(id);
    }
  }
  return ids;
}

export function documentFromEditor(
  base: DocumentMessage,
  doc: ProseNode,
  mint: () => string = newBlockId,
): { document: DocumentMessage; blockIds: string[] } {
  const built = documentFromEditorDoc(base, doc, mint);
  return { document: built.document, blockIds: built.blockIds };
}

// Kept for tests that pass paragraph strings until they migrate to full editor docs.
export function documentFromParagraphTexts(
  base: DocumentMessage,
  paragraphs: readonly string[],
  mint: () => string = newBlockId,
): { document: DocumentMessage; blockIds: string[] } {
  if (paragraphs.length === 0 && base.blocks.length === 0) {
    return { document: base, blockIds: [] };
  }
  const current = visibleParagraphTexts(base);
  const sameLength = current.length === paragraphs.length
    || (current.length === 0 && paragraphs.length === 1 && paragraphs[0] === '');
  if (sameLength && current.every((text: string, index: number) => text === paragraphs[index])) {
    return { document: base, blockIds: paragraphIds(base) };
  }
  const blocks: JsonObject[] = [];
  const ids: string[] = [];
  let index = 0;
  for (const block of base.blocks) {
    if (block.type !== 'paragraph') {
      blocks.push(block as JsonObject);
      continue;
    }
    if (index >= paragraphs.length) {
      continue;
    }
    const text = paragraphs[index] ?? '';
    const id = typeof block.id === 'string' ? block.id : mint();
    blocks.push({
      ...(block as JsonObject),
      id,
      content: text.length === 0 ? [] : [{ type: 'text', text }],
    });
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
