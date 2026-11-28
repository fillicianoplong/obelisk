import type { Block, BodyInline, TableBlock } from '../../shared/schema/types.js';
import type { JsonObject } from '../../shared/ipc/types.js';
import { allowedLinkAddress } from './link.js';
import { cellPlainText } from '../blocks/table/cell-text.js';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;');
}

function inlineText(content: readonly BodyInline[] | undefined): string {
  if (!content) {
    return '';
  }
  let text = '';
  for (const part of content) {
    if (part.type === 'text' || part.type === 'link') {
      text += part.text;
    }
  }
  return text;
}

function inlineToHtml(content: readonly BodyInline[] | undefined): string {
  if (!content) {
    return '';
  }
  let html = '';
  for (const part of content) {
    if (part.type !== 'text' && part.type !== 'link') {
      continue;
    }
    const open: string[] = [];
    const close: string[] = [];
    if (part.type === 'link') {
      const address = allowedLinkAddress(part.address);
      if (address) {
        open.push(`<a href="${escapeAttr(address)}">`);
        close.unshift('</a>');
      }
    } else if (part.marks) {
      if (part.marks.bold) {
        open.push('<b>');
        close.unshift('</b>');
      }
      if (part.marks.italic) {
        open.push('<i>');
        close.unshift('</i>');
      }
      if (part.marks.underline) {
        open.push('<u>');
        close.unshift('</u>');
      }
      if (part.marks.strike) {
        open.push('<s>');
        close.unshift('</s>');
      }
      if (part.marks.code) {
        open.push('<code>');
        close.unshift('</code>');
      }
    }
    html += `${open.join('')}${escapeHtml(part.text)}${close.join('')}`;
  }
  return html;
}

function tableToHtml(block: TableBlock): string {
  const rows = block.rows.map((row, rowIndex) => {
    const cells = row.cells.map((cell) => {
      const tag = block.headerRow && rowIndex === 0 ? 'th' : 'td';
      const text = cell.kind === 'formula' ? cell.source : cellPlainText(cell);
      return `<${tag}>${escapeHtml(text)}</${tag}>`;
    }).join('');
    return `<tr>${cells}</tr>`;
  }).join('');
  return `<table>${rows}</table>`;
}

function listToHtml(block: Extract<Block, { type: 'list' }>): string {
  const tag = block.style === 'numbered' ? 'ol' : 'ul';
  const items = block.items.map((item) => `<li>${inlineToHtml(item.content)}</li>`).join('');
  return `<${tag}>${items}</${tag}>`;
}

function blockToHtml(block: Block | JsonObject): string {
  const type = block.type;
  if (type === 'paragraph') {
    return `<p>${inlineToHtml(block.content as BodyInline[])}</p>`;
  }
  if (type === 'heading') {
    const level = typeof block.level === 'number' ? Math.min(6, Math.max(1, block.level)) : 1;
    return `<h${level}>${inlineToHtml(block.content as BodyInline[])}</h${level}>`;
  }
  if (type === 'quote') {
    return `<blockquote>${inlineToHtml(block.content as BodyInline[])}</blockquote>`;
  }
  if (type === 'list') {
    return listToHtml(block as Extract<Block, { type: 'list' }>);
  }
  if (type === 'code' && typeof block.text === 'string') {
    return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
  }
  if (type === 'divider') {
    return '<hr>';
  }
  if (type === 'table') {
    return tableToHtml(block as TableBlock);
  }
  const text = inlineText((block as JsonObject).content as unknown as BodyInline[] | undefined);
  if (text.length > 0) {
    return `<p>${escapeHtml(text)}</p>`;
  }
  return '';
}

function tablePlainText(block: TableBlock): string {
  return block.rows.map((row) => row.cells.map((cell) => (
    cell.kind === 'formula' ? cell.source : cellPlainText(cell)
  )).join('\t')).join('\n');
}

function blockPlainText(block: Block | JsonObject): string {
  const type = block.type;
  if (type === 'paragraph' || type === 'heading' || type === 'quote') {
    return inlineText(block.content as BodyInline[]);
  }
  if (type === 'list' && Array.isArray(block.items)) {
    return (block.items as Array<{ content?: BodyInline[] }>).map((item) => inlineText(item.content)).join('\n');
  }
  if (type === 'code' && typeof block.text === 'string') {
    return block.text.replace(/\r\n/g, '\n');
  }
  if (type === 'table') {
    return tablePlainText(block as TableBlock);
  }
  return '';
}

export function blocksRichHtml(blocks: readonly (Block | JsonObject)[]): string {
  return blocks.map((block) => blockToHtml(block)).filter((html) => html.length > 0).join('');
}

export function blocksPlainText(blocks: readonly (Block | JsonObject)[]): string {
  const parts = blocks.map((block) => blockPlainText(block)).filter((text) => text.length > 0);
  return parts.join('\n\n');
}