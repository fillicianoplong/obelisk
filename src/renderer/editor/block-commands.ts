import { Node as ProseNode } from 'prosemirror-model';
import type { Transaction } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import type { JsonObject } from '../../shared/ipc/types.js';
import type { TextBlockKind } from './schema/index.js';
import { blockNodeFromJson, cloneBlockWithNewId } from './schema/mapping.js';

function docInsertPos(doc: ProseNode, after: number | undefined): number {
  if (after === undefined || after < 0 || after >= doc.childCount) {
    return doc.content.size;
  }
  let pos = 0;
  for (let index = 0; index <= after; index += 1) {
    pos += doc.child(index).nodeSize;
  }
  return pos;
}

export function createTextBlockNode(
  kind: TextBlockKind,
  schema: ProseNode['type']['schema'],
  mint: () => string,
  options: { level?: number; text?: string } = {},
): ProseNode {
  const blockId = mint();
  const text = options.text ?? '';
  const inline = text.length > 0 ? schema.text(text) : null;
  switch (kind) {
    case 'paragraph':
      return schema.nodes.paragraph.create({
        blockId,
        align: 'left',
        lineSpacing: 'single',
        spaceBefore: 0,
        spaceAfter: 0,
        indentLeft: 0,
        indentFirst: 0,
        indentHanging: 0,
      }, inline);
    case 'heading':
      return schema.nodes.heading.create({ blockId, level: options.level ?? 1 }, inline);
    case 'bulleted-list':
      return schema.nodes.bullet_list.create({ blockId }, [
        schema.nodes.list_item.create({ level: 0 }, inline),
      ]);
    case 'numbered-list':
      return schema.nodes.ordered_list.create({ blockId }, [
        schema.nodes.list_item.create({ level: 0 }, inline),
      ]);
    case 'checklist':
      return schema.nodes.checklist.create({ blockId }, [
        schema.nodes.checklist_item.create({ level: 0, checked: false }, inline),
      ]);
    case 'quote':
      return schema.nodes.blockquote.create({ blockId }, inline);
    case 'code':
      return schema.nodes.code_block.create({ blockId }, inline);
    case 'divider':
      return schema.nodes.horizontal_rule.create({ blockId });
    case 'page-break':
      return schema.nodes.page_break.create({ blockId });
    default:
      return schema.nodes.paragraph.create({
        blockId,
        align: 'left',
        lineSpacing: 'single',
        spaceBefore: 0,
        spaceAfter: 0,
        indentLeft: 0,
        indentFirst: 0,
        indentHanging: 0,
      }, inline);
  }
}

export function insertTextBlock(
  tr: Transaction,
  kind: TextBlockKind,
  mint: () => string,
  options: { level?: number; text?: string; after?: number } = {},
): Transaction {
  const node = createTextBlockNode(kind, tr.doc.type.schema, mint, options);
  const pos = docInsertPos(tr.doc, options.after);
  return tr.insert(pos, node);
}

export function duplicateBlockAt(
  tr: Transaction,
  blockIndex: number,
  mint: () => string,
): Transaction {
  const node = tr.doc.child(blockIndex);
  const json = node.toJSON() as { type: string; attrs?: Record<string, unknown> };
  json.attrs = { ...json.attrs, blockId: mint() };
  const copy = ProseNode.fromJSON(tr.doc.type.schema, json);
  const pos = docInsertPos(tr.doc, blockIndex);
  return tr.insert(pos, copy);
}

export function pasteBlockJson(
  tr: Transaction,
  block: JsonObject,
  mint: () => string,
  after?: number,
): Transaction {
  const withId = cloneBlockWithNewId(block, mint);
  const node = blockNodeFromJson(withId, tr.doc.type.schema);
  if (node === null) {
    throw new Error('The block could not be inserted.');
  }
  const pos = docInsertPos(tr.doc, after);
  return tr.insert(pos, node);
}

export function setChecklistItemChecked(
  tr: Transaction,
  blockIndex: number,
  itemIndex: number,
  checked: boolean,
): Transaction {
  const block = tr.doc.child(blockIndex);
  if (block.type.name !== 'checklist') {
    throw new Error('That block is not a checklist.');
  }
  let offset = 0;
  for (let index = 0; index < blockIndex; index += 1) {
    offset += tr.doc.child(index).nodeSize;
  }
  offset += 1;
  for (let index = 0; index < itemIndex; index += 1) {
    offset += block.child(index).nodeSize;
  }
  const item = block.child(itemIndex);
  return tr.setNodeMarkup(offset, undefined, { ...item.attrs, checked });
}

export function caretInsideBlock(doc: ProseNode, blockIndex: number, offset = 0): TextSelection {
  let pos = 0;
  for (let index = 0; index < blockIndex; index += 1) {
    pos += doc.child(index).nodeSize;
  }
  const block = doc.child(blockIndex);
  if (block.isTextblock) {
    const clamped = Math.max(0, Math.min(offset, block.content.size));
    return TextSelection.create(doc, pos + 1 + clamped);
  }
  return TextSelection.create(doc, pos + 1);
}
