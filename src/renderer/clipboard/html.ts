import {
  BLOCK_MAX,
  LIST_LEVEL_MAX,
  LIST_LEVEL_MIN,
  TABLE_CELL_MAX_CHARS,
  TABLE_COLUMN_MAX,
  TABLE_ROW_MAX,
  TEXT_MAX_CHARS,
} from '../../shared/schema/limits.js';
import type {
  Block,
  BodyInline,
  CheckListItem,
  ImageBlock,
  PlainListItem,
} from '../../shared/schema/types.js';
import { cleanAlt, displayInches, imageBytesFromDataUrl, rememberImage } from './image-bytes.js';
import { allowedLinkAddress } from './link.js';
import type { PastedImageAsset } from './types.js';
import {
  NO_MARKS,
  collapseInline,
  inlineLength,
  limitInlines,
  limitText,
  paragraphBlock,
  sameMarks,
  stripUnsafe,
  textMarks,
  withMark,
  type MarkState,
} from './text.js';

const MAX_DEPTH = 48;
const MAX_NODES = 100_000;

const DROP_TAGS = new Set([
  'applet',
  'audio',
  'base',
  'button',
  'canvas',
  'embed',
  'frame',
  'frameset',
  'head',
  'iframe',
  'input',
  'link',
  'math',
  'meta',
  'noframes',
  'noscript',
  'object',
  'option',
  'optgroup',
  'param',
  'portal',
  'script',
  'select',
  'source',
  'style',
  'svg',
  'template',
  'textarea',
  'title',
  'track',
  'video',
]);

const FLOW_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'caption',
  'center',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hgroup',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'summary',
  'table',
  'td',
  'th',
  'tr',
  'ul',
]);

interface BuildCtx {
  ids: () => string;
  assets: Map<string, PastedImageAsset>;
  depth: number;
  nodes: number;
}

interface TextPiece {
  kind: 'text';
  text: string;
  marks: MarkState;
  link?: string;
}

interface ImagePiece {
  kind: 'image';
  block: ImageBlock;
}

interface BlockPiece {
  kind: 'block';
  blocks: Block[];
}

type Piece = TextPiece | ImagePiece | BlockPiece;

type ListStyle = 'bulleted' | 'numbered' | 'checklist';

type ListItem = PlainListItem | CheckListItem;

export interface HtmlRead {
  ids: () => string;
  assets: Map<string, PastedImageAsset>;
}

function tagName(node: Node): string {
  if (node.nodeType !== 1) {
    return '';
  }
  const element = node as Element;
  const local = element.localName;
  if (typeof local === 'string' && local.length > 0) {
    return local.toLowerCase();
  }
  return element.tagName.toLowerCase();
}

function nodesOf(node: ParentNode): Node[] {
  return Array.from(node.childNodes);
}

function stopped(ctx: BuildCtx): boolean {
  return ctx.nodes > MAX_NODES;
}

function pushBlock(blocks: Block[], block: Block): void {
  if (blocks.length < BLOCK_MAX) {
    blocks.push(block);
  }
}

function mergeAdjacent(content: readonly BodyInline[]): BodyInline[] {
  const out: BodyInline[] = [];
  for (const item of content) {
    if ((item.type !== 'text' && item.type !== 'link') || item.text.length === 0) {
      continue;
    }
    const previous = out[out.length - 1];
    if (
      previous
      && previous.type === 'text'
      && item.type === 'text'
      && JSON.stringify(previous.marks ?? null) === JSON.stringify(item.marks ?? null)
    ) {
      previous.text += item.text;
      continue;
    }
    if (previous && previous.type === 'link' && item.type === 'link' && previous.address === item.address) {
      previous.text += item.text;
      continue;
    }
    if (item.type === 'link') {
      out.push({ type: 'link', address: item.address, text: item.text });
    } else if (item.marks) {
      out.push({ type: 'text', text: item.text, marks: item.marks });
    } else {
      out.push({ type: 'text', text: item.text });
    }
  }
  return out;
}

function trimEdges(content: readonly BodyInline[]): BodyInline[] {
  if (content.length === 0) {
    return [];
  }
  const copy = content.map((item) => ({ ...item }));
  const first = copy[0];
  if (first && (first.type === 'text' || first.type === 'link')) {
    first.text = first.text.replace(/^[ \t]+/, '');
  }
  const last = copy[copy.length - 1];
  if (last && (last.type === 'text' || last.type === 'link')) {
    last.text = last.text.replace(/[ \t]+$/, '');
  }
  return mergeAdjacent(copy);
}

function isBlank(content: readonly BodyInline[]): boolean {
  for (const item of content) {
    if (item.type !== 'text' && item.type !== 'link') {
      continue;
    }
    if (item.text.replace(/[ \t]/g, '').length > 0) {
      return false;
    }
  }
  return true;
}

function appendBreak(content: BodyInline[]): BodyInline[] {
  if (content.length === 0) {
    return content;
  }
  const next = content.slice();
  const last = next[next.length - 1];
  if (last && last.type === 'text') {
    next[next.length - 1] = last.marks
      ? { type: 'text', text: `${last.text}\n`, marks: last.marks }
      : { type: 'text', text: `${last.text}\n` };
    return next;
  }
  next.push({ type: 'text', text: '\n' });
  return next;
}

function runsFrom(pieces: readonly TextPiece[]): BodyInline[] {
  const out: BodyInline[] = [];
  for (const piece of pieces) {
    if (piece.text.length === 0) {
      continue;
    }
    if (piece.link) {
      out.push({ type: 'link', address: piece.link, text: piece.text });
      continue;
    }
    const marks = textMarks(piece.marks);
    if (marks) {
      out.push({ type: 'text', text: piece.text, marks });
    } else {
      out.push({ type: 'text', text: piece.text });
    }
  }
  return mergeAdjacent(out);
}

function blocksFromPieces(pieces: readonly Piece[], ctx: BuildCtx): Block[] {
  const blocks: Block[] = [];
  let texts: TextPiece[] = [];
  const flush = () => {
    const content = limitInlines(trimEdges(runsFrom(texts)), TEXT_MAX_CHARS);
    texts = [];
    if (isBlank(content)) {
      return;
    }
    pushBlock(blocks, paragraphBlock(ctx.ids(), content));
  };
  for (const piece of pieces) {
    if (blocks.length >= BLOCK_MAX) {
      break;
    }
    if (piece.kind === 'text') {
      texts.push(piece);
    } else if (piece.kind === 'image') {
      flush();
      pushBlock(blocks, piece.block);
    } else {
      flush();
      for (const block of piece.blocks) {
        pushBlock(blocks, block);
      }
    }
  }
  flush();
  return blocks;
}

async function imageFromElement(element: Element, ctx: BuildCtx): Promise<ImageBlock | null> {
  const src = element.getAttribute('src');
  if (!src) {
    return null;
  }
  const bytes = imageBytesFromDataUrl(src);
  if (!bytes) {
    return null;
  }
  return imageBlockFromBytes(bytes, element.getAttribute('alt') ?? '', ctx);
}

export async function imageBlockFromBytes(
  bytes: Uint8Array,
  alt: string,
  read: HtmlRead,
): Promise<ImageBlock | null> {
  const asset = await rememberImage(bytes, read.assets);
  if (!asset) {
    return null;
  }
  return {
    type: 'image',
    id: read.ids(),
    sha256: asset.sha256,
    width: displayInches(asset.pixelWidth),
    rotation: 0,
    flipHorizontal: false,
    flipVertical: false,
    alt: cleanAlt(alt),
  };
}

function applyLink(pieces: readonly Piece[], address: string): Piece[] {
  const out: Piece[] = [];
  let text = '';
  const flush = () => {
    const tidy = text.replace(/[ \t\f\v]+/g, ' ').replace(/^[ ]+|[ ]+$/g, '');
    if (tidy.replace(/[ \t\n]/g, '').length > 0) {
      out.push({ kind: 'text', text: tidy, marks: NO_MARKS, link: address });
    }
    text = '';
  };
  for (const piece of pieces) {
    if (piece.kind === 'text') {
      text += piece.text;
    } else {
      flush();
      out.push(piece);
    }
  }
  flush();
  return out;
}

async function piecesFrom(nodes: readonly Node[], marks: MarkState, ctx: BuildCtx): Promise<Piece[]> {
  const pieces: Piece[] = [];
  for (const node of nodes) {
    ctx.nodes += 1;
    if (stopped(ctx)) {
      break;
    }
    if (node.nodeType === 3) {
      const text = collapseInline(node.nodeValue ?? '');
      if (text.length > 0) {
        pieces.push({ kind: 'text', text, marks });
      }
      continue;
    }
    if (node.nodeType !== 1) {
      continue;
    }
    const element = node as Element;
    const tag = tagName(element);
    if (DROP_TAGS.has(tag) || ctx.depth >= MAX_DEPTH) {
      continue;
    }
    ctx.depth += 1;
    try {
      if (tag === 'br') {
        pieces.push({ kind: 'text', text: '\n', marks });
      } else if (tag === 'img') {
        const block = await imageFromElement(element, ctx);
        if (block) {
          pieces.push({ kind: 'image', block });
        }
      } else if (tag === 'a') {
        const inner = await piecesFrom(nodesOf(element), withMark(marks, tag), ctx);
        const address = allowedLinkAddress(element.getAttribute('href') ?? '');
        pieces.push(...(address ? applyLink(inner, address) : inner));
      } else if (FLOW_TAGS.has(tag)) {
        const blocks = await fromTag(element, ctx);
        if (blocks.length > 0) {
          pieces.push({ kind: 'block', blocks });
        }
      } else if (sameMarks(marks, withMark(marks, tag))) {
        pieces.push(...await piecesFrom(nodesOf(element), marks, ctx));
      } else {
        pieces.push(...await piecesFrom(nodesOf(element), withMark(marks, tag), ctx));
      }
    } finally {
      ctx.depth -= 1;
    }
  }
  return pieces;
}

async function fromNodes(nodes: readonly Node[], ctx: BuildCtx): Promise<Block[]> {
  return blocksFromPieces(await piecesFrom(nodes, NO_MARKS, ctx), ctx);
}

async function fromContainer(element: Element, ctx: BuildCtx): Promise<Block[]> {
  return fromNodes(nodesOf(element), ctx);
}

function preText(element: Element, ctx: BuildCtx): string {
  let out = '';
  const walk = (node: Node) => {
    ctx.nodes += 1;
    if (stopped(ctx)) {
      return;
    }
    if (node.nodeType === 3) {
      out += node.nodeValue ?? '';
      return;
    }
    if (node.nodeType !== 1 || ctx.depth >= MAX_DEPTH) {
      return;
    }
    const child = node as Element;
    const tag = tagName(child);
    if (DROP_TAGS.has(tag)) {
      return;
    }
    if (tag === 'br') {
      out += '\n';
      return;
    }
    ctx.depth += 1;
    for (const grandchild of nodesOf(child)) {
      walk(grandchild);
    }
    ctx.depth -= 1;
  };
  for (const child of nodesOf(element)) {
    walk(child);
  }
  const normalized = stripUnsafe(out.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
  const trimmed = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;
  return limitText(trimmed, TEXT_MAX_CHARS);
}

async function fromHeading(element: Element, level: number, ctx: BuildCtx): Promise<Block[]> {
  const blocks = await fromContainer(element, ctx);
  return blocks.map((block) => {
    if (block.type !== 'paragraph') {
      return block;
    }
    return { type: 'heading' as const, id: block.id, level, content: block.content };
  });
}

function coalesceQuotes(blocks: readonly Block[], ids: () => string): Block[] {
  const out: Block[] = [];
  let content: BodyInline[] = [];
  const flush = () => {
    const limited = limitInlines(mergeAdjacent(content), TEXT_MAX_CHARS);
    content = [];
    if (limited.length === 0 || isBlank(limited)) {
      return;
    }
    pushBlock(out, { type: 'quote', id: ids(), content: limited });
  };
  for (const block of blocks) {
    if (block.type === 'paragraph' || block.type === 'quote') {
      if (content.length > 0 && block.content.length > 0) {
        content = appendBreak(content);
      }
      content.push(...block.content);
    } else {
      flush();
      pushBlock(out, block);
    }
  }
  flush();
  return out;
}

async function fromQuote(element: Element, ctx: BuildCtx): Promise<Block[]> {
  return coalesceQuotes(await fromContainer(element, ctx), ctx.ids);
}

function findCheckbox(li: Element): Element | null {
  const walk = (node: Element): Element | null => {
    for (const child of nodesOf(node)) {
      if (child.nodeType !== 1) {
        continue;
      }
      const element = child as Element;
      const tag = tagName(element);
      if (tag === 'ul' || tag === 'ol') {
        continue;
      }
      if (tag === 'input' && (element.getAttribute('type') ?? '').toLowerCase() === 'checkbox') {
        return element;
      }
      const nested = walk(element);
      if (nested) {
        return nested;
      }
    }
    return null;
  };
  return walk(li);
}

function listElements(list: Element): Element[] {
  const items: Element[] = [];
  for (const child of nodesOf(list)) {
    if (child.nodeType === 1 && tagName(child) === 'li') {
      items.push(child as Element);
    }
  }
  return items;
}

function isChecklist(list: Element): boolean {
  const items = listElements(list);
  return items.length > 0 && items.every((item) => findCheckbox(item) !== null);
}

function flattenBlocks(blocks: readonly Block[]): { inline: BodyInline[]; extras: Block[] } {
  const inline: BodyInline[] = [];
  const extras: Block[] = [];
  for (const block of blocks) {
    if (block.type === 'paragraph' || block.type === 'quote' || block.type === 'heading') {
      if (inline.length > 0 && block.content.length > 0) {
        const broken = appendBreak(inline);
        inline.length = 0;
        inline.push(...broken);
      }
      inline.push(...block.content);
    } else if (block.type === 'list') {
      for (const item of block.items) {
        if (inline.length > 0 && item.content.length > 0) {
          const broken = appendBreak(inline);
          inline.length = 0;
          inline.push(...broken);
        }
        inline.push(...item.content);
      }
    } else if (block.type === 'code') {
      if (block.text.length > 0) {
        if (inline.length > 0) {
          const broken = appendBreak(inline);
          inline.length = 0;
          inline.push(...broken);
        }
        inline.push({ type: 'text', text: block.text });
      }
    } else {
      extras.push(block);
    }
  }
  return { inline: mergeAdjacent(inline), extras };
}

function listBlock(style: ListStyle, items: readonly ListItem[], id: string): Block {
  if (style === 'checklist') {
    const checklistItems: CheckListItem[] = items.map((item) => ({
      level: item.level,
      checked: 'checked' in item ? item.checked : false,
      content: item.content,
    }));
    return { type: 'list', id, style: 'checklist', items: checklistItems };
  }
  const plain: PlainListItem[] = items.map((item) => ({ level: item.level, content: item.content }));
  if (style === 'numbered') {
    return { type: 'list', id, style: 'numbered', items: plain };
  }
  return { type: 'list', id, style: 'bulleted', items: plain };
}

async function fromList(element: Element, ctx: BuildCtx, requestedLevel: number): Promise<Block[]> {
  const tag = tagName(element);
  const style: ListStyle = tag === 'ul' && isChecklist(element)
    ? 'checklist'
    : tag === 'ol' ? 'numbered' : 'bulleted';
  const level = Math.min(LIST_LEVEL_MAX, Math.max(LIST_LEVEL_MIN, requestedLevel));
  const out: Block[] = [];
  let items: ListItem[] = [];
  let used = 0;
  const flush = () => {
    if (items.length === 0) {
      return;
    }
    pushBlock(out, listBlock(style, items, ctx.ids()));
    items = [];
    used = 0;
  };
  const takeItems = (incoming: readonly ListItem[]) => {
    for (const item of incoming) {
      const length = inlineLength(item.content);
      if (items.length > 0 && used + length > TEXT_MAX_CHARS) {
        flush();
      }
      items.push(item);
      used += Math.min(length, TEXT_MAX_CHARS);
    }
  };
  for (const child of nodesOf(element)) {
    if (stopped(ctx) || out.length >= BLOCK_MAX) {
      break;
    }
    if (child.nodeType !== 1) {
      continue;
    }
    const node = child as Element;
    const childTag = tagName(node);
    if (childTag !== 'li') {
      if (FLOW_TAGS.has(childTag)) {
        flush();
        for (const block of await fromTag(node, ctx)) {
          pushBlock(out, block);
        }
      }
      continue;
    }
    const contentNodes: Node[] = [];
    const nested: Element[] = [];
    for (const grandchild of nodesOf(node)) {
      if (grandchild.nodeType === 1) {
        const nestedTag = tagName(grandchild);
        if (nestedTag === 'ul' || nestedTag === 'ol') {
          nested.push(grandchild as Element);
          continue;
        }
      }
      contentNodes.push(grandchild);
    }
    const flattened = flattenBlocks(await fromNodes(contentNodes, ctx));
    const content = limitInlines(trimEdges(flattened.inline), TEXT_MAX_CHARS);
    const blank = isBlank(content);
    if (!blank || (flattened.extras.length === 0 && nested.length === 0)) {
      const length = inlineLength(content);
      if (items.length > 0 && used + length > TEXT_MAX_CHARS) {
        flush();
      }
      if (style === 'checklist') {
        items.push({
          level,
          checked: findCheckbox(node)?.hasAttribute('checked') === true,
          content,
        });
      } else {
        items.push({ level, content });
      }
      used += length;
    }
    if (flattened.extras.length > 0) {
      flush();
      for (const extra of flattened.extras) {
        pushBlock(out, extra);
      }
    }
    for (const nestedList of nested) {
      const nestedBlocks = await fromList(nestedList, ctx, level + 1);
      for (const block of nestedBlocks) {
        if (block.type === 'list' && block.style === style) {
          takeItems(block.items);
        } else {
          flush();
          pushBlock(out, block);
        }
      }
    }
  }
  flush();
  return out;
}

function spanCount(element: Element, name: string, max: number): number {
  const raw = element.getAttribute(name);
  const value = raw ? Number.parseInt(raw, 10) : 1;
  if (!Number.isFinite(value) || value < 1) {
    return 1;
  }
  return Math.min(max, value);
}

function columnWidths(count: number): number[] {
  const each = Math.round((6.5 / count) * 1000) / 1000;
  const width = each > 0 && each <= 11 ? each : 1;
  return Array.from({ length: count }, () => width);
}

interface CellSlot {
  content: BodyInline[];
  header: boolean;
}

async function fromTable(table: Element, ctx: BuildCtx): Promise<Block[]> {
  const before: Block[] = [];
  const rows: Element[] = [];
  for (const child of nodesOf(table)) {
    if (child.nodeType !== 1) {
      continue;
    }
    const element = child as Element;
    const tag = tagName(element);
    if (tag === 'caption') {
      before.push(...await fromContainer(element, ctx));
    } else if (tag === 'tr') {
      rows.push(element);
    } else if (tag === 'thead' || tag === 'tbody' || tag === 'tfoot') {
      for (const row of nodesOf(element)) {
        if (row.nodeType === 1 && tagName(row) === 'tr') {
          rows.push(row as Element);
        }
      }
    }
  }
  const grid: Array<Array<CellSlot | null>> = [];
  const extras: Block[] = [];
  const rowLimit = Math.min(rows.length, TABLE_ROW_MAX);
  for (let rowIndex = 0; rowIndex < rowLimit; rowIndex += 1) {
    const row = rows[rowIndex];
    if (!row) {
      continue;
    }
    let column = 0;
    for (const child of nodesOf(row)) {
      if (child.nodeType !== 1) {
        continue;
      }
      const cell = child as Element;
      const cellTag = tagName(cell);
      if (cellTag !== 'td' && cellTag !== 'th') {
        continue;
      }
      while (grid[rowIndex]?.[column]) {
        column += 1;
      }
      if (column >= TABLE_COLUMN_MAX) {
        break;
      }
      const colspan = spanCount(cell, 'colspan', TABLE_COLUMN_MAX - column);
      const rowspan = spanCount(cell, 'rowspan', TABLE_ROW_MAX - rowIndex);
      const flattened = flattenBlocks(await fromContainer(cell, ctx));
      extras.push(...flattened.extras);
      const content = limitInlines(trimEdges(flattened.inline), TABLE_CELL_MAX_CHARS);
      for (let rowOffset = 0; rowOffset < rowspan; rowOffset += 1) {
        const targetRow = rowIndex + rowOffset;
        if (targetRow >= TABLE_ROW_MAX) {
          break;
        }
        while (grid.length <= targetRow) {
          grid.push([]);
        }
        const line = grid[targetRow];
        if (!line) {
          continue;
        }
        for (let columnOffset = 0; columnOffset < colspan; columnOffset += 1) {
          const targetColumn = column + columnOffset;
          if (targetColumn >= TABLE_COLUMN_MAX || line[targetColumn]) {
            continue;
          }
          line[targetColumn] = rowOffset === 0 && columnOffset === 0
            ? { content, header: cellTag === 'th' }
            : { content: [], header: cellTag === 'th' };
        }
      }
      column += colspan;
    }
  }
  let columns = 0;
  for (const line of grid) {
    columns = Math.max(columns, line.length);
  }
  if (columns === 0) {
    return before.slice(0, BLOCK_MAX);
  }
  columns = Math.min(columns, TABLE_COLUMN_MAX);
  const first = grid[0] ?? [];
  const headerRow = first.some((slot) => slot?.header === true)
    && first.every((slot) => slot == null || slot.header);
  const tableRows = grid.slice(0, TABLE_ROW_MAX).map((line) => ({
    cells: Array.from({ length: columns }, (_unused, index) => ({
      kind: 'text' as const,
      content: line[index]?.content ?? [],
    })),
  }));
  const blocks = before.slice();
  pushBlock(blocks, {
    type: 'table',
    id: ctx.ids(),
    headerRow,
    columnWidths: columnWidths(columns),
    rows: tableRows,
  });
  for (const extra of extras) {
    pushBlock(blocks, extra);
  }
  return blocks;
}

async function fromTag(element: Element, ctx: BuildCtx): Promise<Block[]> {
  const tag = tagName(element);
  if (tag === 'ul' || tag === 'ol') {
    return fromList(element, ctx, 0);
  }
  if (tag === 'table') {
    return fromTable(element, ctx);
  }
  if (tag === 'blockquote') {
    return fromQuote(element, ctx);
  }
  if (tag === 'pre') {
    const text = preText(element, ctx);
    if (text.length === 0) {
      return [];
    }
    return [{ type: 'code', id: ctx.ids(), text }];
  }
  if (tag === 'hr') {
    return [{ type: 'divider', id: ctx.ids() }];
  }
  const heading = /^h([1-6])$/.exec(tag);
  if (heading) {
    return fromHeading(element, Number(heading[1]), ctx);
  }
  return fromContainer(element, ctx);
}

export async function blocksFromDocument(document: Document, read: HtmlRead): Promise<Block[]> {
  const ctx: BuildCtx = { ids: read.ids, assets: read.assets, depth: 0, nodes: 0 };
  const body = document.body;
  const nodes = body ? nodesOf(body) : nodesOf(document);
  const blocks = await fromNodes(nodes, ctx);
  return blocks.slice(0, BLOCK_MAX);
}
