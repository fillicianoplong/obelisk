import type {
  BodyInline,
  HeadingBlock,
  NestedBlock,
  ParagraphBlock,
  QuoteBlock,
} from '../../../shared/schema/types.js';
import { newBlockId } from '../../editor/block-id.js';
import { emptyParagraph } from './document.js';

function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) {
    return '';
  }
  let text = '';
  for (const part of content) {
    if (typeof part !== 'object' || part === null || Array.isArray(part)) {
      continue;
    }
    const record = part as { type?: unknown; text?: unknown };
    if ((record.type === 'text' || record.type === 'link') && typeof record.text === 'string') {
      text += record.text;
    }
  }
  return text;
}

function contentFromPlainText(text: string): BodyInline[] {
  if (text.length === 0) {
    return [];
  }
  return [{ type: 'text', text }];
}

export function nestedBlockLabel(block: NestedBlock): string {
  switch (block.type) {
    case 'heading':
      return `Heading ${block.level}`;
    case 'table':
      return 'Table';
    case 'image':
      return 'Image';
    case 'formula':
      return 'Equation';
    default:
      return block.type;
  }
}

export function nestedBlockFromPlain(blockId: string, type: NestedBlock['type'], text: string, level = 1): NestedBlock {
  const content = contentFromPlainText(text);
  switch (type) {
    case 'heading':
      return { type: 'heading', id: blockId, level: level as 1 | 2 | 3, content };
    case 'quote':
      return { type: 'quote', id: blockId, content };
    case 'code':
      return { type: 'code', id: blockId, text: text.replace(/\r\n/g, '\n') };
    case 'divider':
      return { type: 'divider', id: blockId };
    default:
      return { ...emptyParagraph(blockId), content };
  }
}

export function extractNestedFromElement(element: HTMLElement, block: NestedBlock): NestedBlock | null {
  const id = block.id || newBlockId();
  const editable = element.querySelector<HTMLElement>('[data-nested-editable]');
  const text = editable?.textContent ?? '';
  switch (block.type) {
    case 'paragraph':
      return { ...emptyParagraph(id), content: contentFromPlainText(text) };
    case 'heading': {
      const heading = block as HeadingBlock;
      return { type: 'heading', id, level: heading.level, content: contentFromPlainText(text) };
    }
    case 'quote':
      return { type: 'quote', id, content: contentFromPlainText(text) };
    case 'code':
      return { type: 'code', id, text: text.replace(/\r\n/g, '\n') };
    default:
      return block;
  }
}

export function renderNestedBlock(block: NestedBlock): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'columns-nested-block';
  wrap.dataset.nestedType = block.type;
  if (block.id) {
    wrap.dataset.blockId = block.id;
  }
  if (block.type === 'divider') {
    const rule = document.createElement('hr');
    rule.className = 'columns-nested-divider';
    wrap.append(rule);
    return wrap;
  }
  if (block.type === 'table' || block.type === 'image' || block.type === 'formula'
    || block.type === 'drawing' || block.type === 'signature' || block.type === 'diagram') {
    const chip = document.createElement('div');
    chip.className = 'columns-nested-chip';
    chip.textContent = nestedBlockLabel(block);
    wrap.append(chip);
    return wrap;
  }
  const field = document.createElement('div');
  field.className = 'columns-nested-editable';
  field.dataset.nestedEditable = 'true';
  field.contentEditable = 'true';
  field.spellcheck = true;
  if (block.type === 'code') {
    field.classList.add('columns-nested-code');
    field.textContent = block.text ?? '';
  } else if (block.type === 'heading') {
    field.classList.add(`columns-nested-h${block.level}`);
    field.textContent = textFromContent(block.content);
  } else if (block.type === 'quote') {
    field.classList.add('columns-nested-quote');
    field.textContent = textFromContent((block as QuoteBlock).content);
  } else {
    field.textContent = textFromContent((block as ParagraphBlock).content);
  }
  wrap.append(field);
  return wrap;
}