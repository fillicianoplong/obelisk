import type { Node as ProseNode, Schema } from 'prosemirror-model';
import type { JsonObject, JsonValue } from '../../../shared/ipc/types.js';
import type { DocumentMessage } from '../../../shared/ipc/types.js';
import { editorSchema } from './index.js';

const TEXT_TYPES = new Set([
  'paragraph',
  'heading',
  'list',
  'quote',
  'code',
  'divider',
  'pageBreak',
]);

export function isTextBlockType(type: unknown): boolean {
  return typeof type === 'string' && TEXT_TYPES.has(type);
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

function textRuns(text: string): JsonObject[] {
  if (text.length === 0) {
    return [];
  }
  return [{ type: 'text', text }];
}

function paragraphFieldsFrom(block: JsonObject): Record<string, JsonValue> {
  return {
    align: block.align ?? 'left',
    lineSpacing: block.lineSpacing ?? 'single',
    spaceBefore: block.spaceBefore ?? 0,
    spaceAfter: block.spaceAfter ?? 0,
    indents: block.indents ?? { left: 0, first: 0, hanging: 0 },
  };
}

function paragraphAttrsFrom(block: JsonObject, blockId: string): Record<string, JsonValue> {
  const indents = (block.indents ?? { left: 0, first: 0, hanging: 0 }) as JsonObject;
  return {
    blockId,
    align: block.align ?? 'left',
    lineSpacing: block.lineSpacing ?? 'single',
    spaceBefore: block.spaceBefore ?? 0,
    spaceAfter: block.spaceAfter ?? 0,
    indentLeft: indents.left ?? 0,
    indentFirst: indents.first ?? 0,
    indentHanging: indents.hanging ?? 0,
  };
}

function createParagraphNode(schema: Schema, block: JsonObject, blockId: string, text: string): ProseNode {
  const attrs = paragraphAttrsFrom(block, blockId);
  const content = text.length > 0 ? schema.text(text) : null;
  return schema.nodes.paragraph.create(attrs, content);
}

function listItemsFromBlock(block: JsonObject, schema: Schema, checklist: boolean): ProseNode[] {
  const items = Array.isArray(block.items) ? block.items : [];
  const itemType = checklist ? schema.nodes.checklist_item : schema.nodes.list_item;
  return items.map((raw) => {
    const item = raw as JsonObject;
    const level = typeof item.level === 'number' ? item.level : 0;
    const text = inlineText(item.content);
    const attrs = checklist
      ? { level, checked: item.checked === true }
      : { level };
    const content = text.length > 0 ? schema.text(text) : null;
    return itemType.create(attrs, content);
  });
}

export function blockNodeFromJson(block: JsonObject, schema: Schema = editorSchema): ProseNode | null {
  const type = block.type;
  const blockId = typeof block.id === 'string' ? block.id : '';
  if (type === 'paragraph') {
    return createParagraphNode(schema, block, blockId, inlineText(block.content));
  }
  if (type === 'heading') {
    const level = typeof block.level === 'number' ? block.level : 1;
    const text = inlineText(block.content);
    const content = text.length > 0 ? schema.text(text) : null;
    return schema.nodes.heading.create({ blockId, level }, content);
  }
  if (type === 'list') {
    const style = block.style;
    if (style === 'bulleted') {
      const items = listItemsFromBlock(block, schema, false);
      if (items.length === 0) {
        items.push(schema.nodes.list_item.create({ level: 0 }));
      }
      return schema.nodes.bullet_list.create({ blockId }, items);
    }
    if (style === 'numbered') {
      const items = listItemsFromBlock(block, schema, false);
      if (items.length === 0) {
        items.push(schema.nodes.list_item.create({ level: 0 }));
      }
      return schema.nodes.ordered_list.create({ blockId }, items);
    }
    if (style === 'checklist') {
      const items = listItemsFromBlock(block, schema, true);
      if (items.length === 0) {
        items.push(schema.nodes.checklist_item.create({ level: 0, checked: false }));
      }
      return schema.nodes.checklist.create({ blockId }, items);
    }
    return null;
  }
  if (type === 'quote') {
    const text = inlineText(block.content);
    const content = text.length > 0 ? schema.text(text) : null;
    return schema.nodes.blockquote.create({ blockId }, content);
  }
  if (type === 'code') {
    const text = typeof block.text === 'string' ? block.text : '';
    const content = text.length > 0 ? schema.text(text.replace(/\r\n/g, '\n')) : null;
    return schema.nodes.code_block.create({ blockId }, content);
  }
  if (type === 'divider') {
    return schema.nodes.horizontal_rule.create({ blockId });
  }
  if (type === 'pageBreak') {
    return schema.nodes.page_break.create({ blockId });
  }
  if (typeof type === 'string') {
    return schema.nodes.foreign_block.create({ blockId, blockType: type });
  }
  return null;
}

export function editorDocFromDocument(document: DocumentMessage, schema: Schema = editorSchema): ProseNode {
  const blocks = document.blocks.length === 0
    ? [schema.nodes.paragraph.create({ blockId: '' })]
    : document.blocks.map((block) => {
      const node = blockNodeFromJson(block as JsonObject, schema);
      if (node === null) {
        return schema.nodes.paragraph.create({ blockId: '' });
      }
      return node;
    });
  return schema.node('doc', null, blocks);
}

function paragraphBlockJson(node: ProseNode, base: JsonObject | null, mint: () => string): JsonObject {
  const blockId = node.attrs.blockId || mint();
  const text = node.textContent;
  const fields = base && base.type === 'paragraph' ? paragraphFieldsFrom(base) : paragraphFieldsFrom({});
  const unchanged = base
    && base.type === 'paragraph'
    && base.id === blockId
    && inlineText(base.content) === text;
  if (unchanged) {
    return base;
  }
  return {
    type: 'paragraph',
    id: blockId,
    ...fields,
    content: textRuns(text),
  };
}

function headingBlockJson(node: ProseNode, base: JsonObject | null, mint: () => string): JsonObject {
  const blockId = node.attrs.blockId || mint();
  const level = Number(node.attrs.level) || 1;
  const text = node.textContent;
  const unchanged = base
    && base.type === 'heading'
    && base.id === blockId
    && base.level === level
    && inlineText(base.content) === text;
  if (unchanged) {
    return base;
  }
  return {
    type: 'heading',
    id: blockId,
    level,
    content: textRuns(text),
  };
}

function listItemsToJson(node: ProseNode, checklist: boolean): JsonObject[] {
  const itemName = checklist ? 'checklist_item' : 'list_item';
  const items: JsonObject[] = [];
  node.forEach((child) => {
    if (child.type.name !== itemName) {
      return;
    }
    const entry: JsonObject = {
      level: child.attrs.level ?? 0,
      content: textRuns(child.textContent),
    };
    if (checklist) {
      entry.checked = child.attrs.checked === true;
    }
    items.push(entry);
  });
  return items;
}

function listItemsEqual(left: JsonObject[], right: JsonObject[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((item, index) => {
    const other = right[index];
    if ((item.level ?? 0) !== (other.level ?? 0)) {
      return false;
    }
    if (Object.hasOwn(item, 'checked') || Object.hasOwn(other, 'checked')) {
      if (item.checked !== other.checked) {
        return false;
      }
    }
    return JSON.stringify(item.content ?? []) === JSON.stringify(other.content ?? []);
  });
}

function listBlockJson(
  node: ProseNode,
  style: 'bulleted' | 'numbered' | 'checklist',
  base: JsonObject | null,
  mint: () => string,
): JsonObject {
  const blockId = node.attrs.blockId || mint();
  const checklist = style === 'checklist';
  const items = listItemsToJson(node, checklist);
  const unchanged = base
    && base.type === 'list'
    && base.style === style
    && base.id === blockId
    && listItemsEqual(
      items,
      Array.isArray(base.items) ? base.items as JsonObject[] : [],
    );
  if (unchanged) {
    return base;
  }
  return {
    type: 'list',
    id: blockId,
    style,
    items,
  };
}

function quoteBlockJson(node: ProseNode, base: JsonObject | null, mint: () => string): JsonObject {
  const blockId = node.attrs.blockId || mint();
  const text = node.textContent;
  const unchanged = base
    && base.type === 'quote'
    && base.id === blockId
    && inlineText(base.content) === text;
  if (unchanged) {
    return base;
  }
  return {
    type: 'quote',
    id: blockId,
    content: textRuns(text),
  };
}

function normalizeCodeText(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

function codeBlockJson(node: ProseNode, base: JsonObject | null, mint: () => string): JsonObject {
  const blockId = node.attrs.blockId || mint();
  const text = normalizeCodeText(node.textContent);
  const unchanged = base
    && base.type === 'code'
    && base.id === blockId
    && normalizeCodeText(String(base.text ?? '')) === text;
  if (unchanged) {
    return base;
  }
  return {
    type: 'code',
    id: blockId,
    text,
  };
}

function atomBlockJson(type: string, node: ProseNode, base: JsonObject | null, mint: () => string): JsonObject {
  const blockId = node.attrs.blockId || mint();
  if (base && base.type === type && base.id === blockId) {
    return base;
  }
  return { type, id: blockId };
}

function blockJsonFromNode(
  node: ProseNode,
  base: JsonObject | null,
  mint: () => string,
): JsonObject {
  switch (node.type.name) {
    case 'paragraph':
      return paragraphBlockJson(node, base, mint);
    case 'heading':
      return headingBlockJson(node, base, mint);
    case 'bullet_list':
      return listBlockJson(node, 'bulleted', base, mint);
    case 'ordered_list':
      return listBlockJson(node, 'numbered', base, mint);
    case 'checklist':
      return listBlockJson(node, 'checklist', base, mint);
    case 'blockquote':
      return quoteBlockJson(node, base, mint);
    case 'code_block':
      return codeBlockJson(node, base, mint);
    case 'horizontal_rule':
      return atomBlockJson('divider', node, base, mint);
    case 'page_break':
      return atomBlockJson('pageBreak', node, base, mint);
    case 'foreign_block':
      if (base) {
        return base;
      }
      return { type: node.attrs.blockType ?? 'unknown', id: node.attrs.blockId || mint() };
    default:
      return { type: 'paragraph', id: mint(), ...paragraphFieldsFrom({}), content: textRuns(node.textContent) };
  }
}

export function blockIdsFromDocument(document: DocumentMessage): string[] {
  const ids: string[] = [];
  for (const block of document.blocks) {
    if (typeof block.id === 'string') {
      ids.push(block.id);
    }
  }
  return ids;
}

export function documentFromEditorDoc(
  base: DocumentMessage,
  doc: ProseNode,
  mint: () => string,
): { document: DocumentMessage; blockIds: string[]; unchanged: boolean } {
  const blocks: JsonObject[] = [];
  const ids: string[] = [];
  let index = 0;
  let unchanged = true;
  for (let childIndex = 0; childIndex < doc.childCount; childIndex += 1) {
    const node = doc.child(childIndex);
    const baseBlock = index < base.blocks.length ? (base.blocks[index] as JsonObject) : null;
    const next = blockJsonFromNode(node, baseBlock, mint);
    blocks.push(next);
    if (typeof next.id === 'string') {
      ids.push(next.id);
    }
    if (next !== baseBlock) {
      unchanged = false;
    }
    index += 1;
  }
  if (index !== base.blocks.length) {
    unchanged = false;
  }
  if (unchanged) {
    return { document: base, blockIds: blockIdsFromDocument(base), unchanged: true };
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
    unchanged: false,
  };
}

export interface EditorBlockSnapshot {
  type: string;
  level?: number;
  style?: string;
  checked?: boolean;
  text?: string;
  id?: string;
}

export function editorBlockSnapshot(doc: ProseNode): EditorBlockSnapshot[] {
  const snapshots: EditorBlockSnapshot[] = [];
  doc.forEach((node) => {
    switch (node.type.name) {
      case 'paragraph':
        snapshots.push({ type: 'paragraph', id: node.attrs.blockId, text: node.textContent });
        break;
      case 'heading':
        snapshots.push({
          type: 'heading',
          id: node.attrs.blockId,
          level: node.attrs.level,
          text: node.textContent,
        });
        break;
      case 'bullet_list':
        snapshots.push({
          type: 'list',
          style: 'bulleted',
          id: node.attrs.blockId,
          text: node.textContent,
        });
        break;
      case 'ordered_list':
        snapshots.push({
          type: 'list',
          style: 'numbered',
          id: node.attrs.blockId,
          text: node.textContent,
        });
        break;
      case 'checklist':
        snapshots.push({
          type: 'list',
          style: 'checklist',
          id: node.attrs.blockId,
          text: node.textContent,
          checked: node.firstChild?.attrs.checked === true,
        });
        break;
      case 'blockquote':
        snapshots.push({ type: 'quote', id: node.attrs.blockId, text: node.textContent });
        break;
      case 'code_block':
        snapshots.push({ type: 'code', id: node.attrs.blockId, text: node.textContent });
        break;
      case 'horizontal_rule':
        snapshots.push({ type: 'divider', id: node.attrs.blockId });
        break;
      case 'page_break':
        snapshots.push({ type: 'pageBreak', id: node.attrs.blockId });
        break;
      case 'foreign_block':
        snapshots.push({ type: node.attrs.blockType, id: node.attrs.blockId });
        break;
      default:
        snapshots.push({ type: node.type.name, text: node.textContent });
    }
  });
  return snapshots;
}

export function cloneBlockWithNewId(block: JsonObject, mint: () => string): JsonObject {
  const copy = structuredClone(block) as JsonObject;
  copy.id = mint();
  return copy;
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

export function paragraphIds(document: DocumentMessage): string[] {
  return blockIdsFromDocument(document);
}
