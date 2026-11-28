import path from 'node:path';
import type { DocumentMessage, ExportAssets, JsonObject } from '../../../shared/ipc/types.js';
import type { ExportCompanionFile } from '../writers/types.js';
import { formatDateChip } from './dates.js';
import { escapeMarkdownAlt, escapeMarkdownText, escapeTableCell, prepareExportText } from './escape.js';
import { markdownImagesFolderName } from './folder.js';
import { rasterExtension, sniffRasterKind } from './sniff.js';

type Inline = JsonObject;
type Block = JsonObject;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeBase64(value: string): Uint8Array {
  const binary = Buffer.from(value, 'base64');
  return new Uint8Array(binary.buffer, binary.byteOffset, binary.byteLength);
}

function inlineText(inline: readonly Inline[]): string {
  let out = '';
  for (const item of inline) {
    if (!isRecord(item) || typeof item.type !== 'string') {
      continue;
    }
    if (item.type === 'text' && typeof item.text === 'string') {
      out += escapeMarkdownText(item.text);
    } else if (item.type === 'link'
      && typeof item.text === 'string'
      && typeof item.address === 'string') {
      out += `[${escapeMarkdownText(item.text)}](${item.address})`;
    } else if (item.type === 'inlineFormula' && typeof item.latex === 'string') {
      out += `$${prepareExportText(item.latex)}$`;
    } else if (item.type === 'dateChip'
      && typeof item.dateTime === 'string'
      && typeof item.format === 'string') {
      out += formatDateChip({
        type: 'dateChip',
        dateTime: item.dateTime,
        format: item.format as never,
      });
    }
  }
  return out;
}

interface ImageSink {
  folderName: string;
  nextIndex: number;
  assetIndex: number;
  companions: ExportCompanionFile[];
}

function takeImageBytes(assets: ExportAssets, sink: ImageSink): Uint8Array | null {
  const encoded = assets.images[sink.assetIndex];
  sink.assetIndex += 1;
  if (typeof encoded !== 'string' || encoded.length < 1) {
    return null;
  }
  return decodeBase64(encoded);
}

function pushImage(
  sink: ImageSink,
  alt: string,
  bytes: Uint8Array,
): string | null {
  const kind = sniffRasterKind(bytes);
  const ext = rasterExtension(kind);
  const name = `image-${String(sink.nextIndex).padStart(3, '0')}.${ext}`;
  sink.nextIndex += 1;
  const relative = path.posix.join(sink.folderName, name);
  sink.companions.push({ relativePath: relative.replace(/\\/g, '/'), bytes });
  const escapedAlt = escapeMarkdownAlt(alt);
  return `![${escapedAlt}](${relative.replace(/\\/g, '/')})`;
}

function padRow(row: string[], width: number): string[] {
  const copy = row.slice();
  while (copy.length < width) {
    copy.push('');
  }
  return copy;
}

function renderTable(block: Block): string | null {
  const rows = Array.isArray(block.rows) ? block.rows as JsonObject[] : [];
  const rendered: string[][] = [];
  for (const row of rows) {
    if (!isRecord(row) || !Array.isArray(row.cells)) {
      continue;
    }
    const line: string[] = [];
    for (const cell of row.cells as JsonObject[]) {
      if (!isRecord(cell) || typeof cell.kind !== 'string') {
        line.push('');
        continue;
      }
      if (cell.kind === 'text' && Array.isArray(cell.content)) {
        line.push(escapeTableCell(inlineText(cell.content as Inline[])));
      } else if (cell.kind === 'formula' && typeof cell.source === 'string') {
        line.push(escapeTableCell(prepareExportText(cell.source)));
      } else {
        line.push('');
      }
    }
    if (line.length > 0) {
      rendered.push(line);
    }
  }
  if (rendered.length < 1) {
    return null;
  }
  const width = Math.max(...rendered.map((row) => row.length));
  const tableLines: string[] = [];
  const header = padRow(rendered[0], width);
  tableLines.push(`| ${header.join(' | ')} |`);
  tableLines.push(`| ${header.map(() => '---').join(' | ')} |`);
  const bodyStart = block.headerRow === true ? 1 : 1;
  for (let index = bodyStart; index < rendered.length; index += 1) {
    const row = padRow(rendered[index], width);
    tableLines.push(`| ${row.join(' | ')} |`);
  }
  return tableLines.join('\n');
}

function renderBlock(block: Block, chunks: string[], sink: ImageSink, assets: ExportAssets): void {
  if (!isRecord(block) || typeof block.type !== 'string') {
    return;
  }
  switch (block.type) {
    case 'paragraph': {
      const content = Array.isArray(block.content) ? block.content as Inline[] : [];
      const text = inlineText(content);
      chunks.push(text.length > 0 ? text : '');
      break;
    }
    case 'heading': {
      const level = typeof block.level === 'number' ? Math.min(6, Math.max(1, block.level)) : 1;
      const content = Array.isArray(block.content) ? block.content as Inline[] : [];
      chunks.push(`${'#'.repeat(level)} ${inlineText(content)}`);
      break;
    }
    case 'list': {
      const items = Array.isArray(block.items) ? block.items as JsonObject[] : [];
      const style = block.style;
      const listLines: string[] = [];
      for (const item of items) {
        if (!isRecord(item)) {
          continue;
        }
        const level = typeof item.level === 'number' ? Math.max(0, item.level) : 0;
        const indent = '  '.repeat(level);
        const content = Array.isArray(item.content) ? item.content as Inline[] : [];
        const text = inlineText(content);
        if (style === 'numbered') {
          listLines.push(`${indent}1. ${text}`);
        } else if (style === 'checklist') {
          const mark = item.checked === true ? 'x' : ' ';
          listLines.push(`${indent}- [${mark}] ${text}`);
        } else {
          listLines.push(`${indent}- ${text}`);
        }
      }
      if (listLines.length > 0) {
        chunks.push(listLines.join('\n'));
      }
      break;
    }
    case 'quote': {
      const content = Array.isArray(block.content) ? block.content as Inline[] : [];
      const text = inlineText(content);
      chunks.push(text.split('\n').map((line) => `> ${line}`).join('\n'));
      break;
    }
    case 'code':
      if (typeof block.text === 'string') {
        const body = prepareExportText(block.text).replace(/\r\n/g, '\n');
        chunks.push(['```', body, '```'].join('\n'));
      }
      break;
    case 'divider':
      chunks.push('---');
      break;
    case 'pageBreak':
      break;
    case 'table': {
      const table = renderTable(block);
      if (table !== null) {
        chunks.push(table);
      }
      break;
    }
    case 'image': {
      const bytes = takeImageBytes(assets, sink);
      const alt = typeof block.alt === 'string' ? block.alt : '';
      if (bytes !== null) {
        const link = pushImage(sink, alt, bytes);
        if (link !== null) {
          chunks.push(link);
        }
      }
      break;
    }
    case 'formula':
      if (typeof block.latex === 'string') {
        chunks.push(['$$', prepareExportText(block.latex), '$$'].join('\n'));
      }
      break;
    case 'drawing':
    case 'signature':
    case 'diagram': {
      const bytes = takeImageBytes(assets, sink);
      const alt = block.type === 'signature' ? 'Signature' : block.type === 'diagram' ? 'Diagram' : 'Drawing';
      if (bytes !== null) {
        const link = pushImage(sink, alt, bytes);
        if (link !== null) {
          chunks.push(link);
        }
      }
      break;
    }
    case 'columns': {
      const cols = Array.isArray(block.columns) ? block.columns as JsonObject[] : [];
      for (const column of cols) {
        if (!isRecord(column) || !Array.isArray(column.blocks)) {
          continue;
        }
        for (const nested of column.blocks as Block[]) {
          renderBlock(nested, chunks, sink, assets);
        }
      }
      break;
    }
    default:
      break;
  }
}

export interface MarkdownExportResult {
  markdown: string;
  companions: ExportCompanionFile[];
}

export function buildMarkdownExport(
  document: DocumentMessage,
  assets: ExportAssets,
  mdFilePath: string,
): MarkdownExportResult {
  const folderName = markdownImagesFolderName(mdFilePath);
  const sink: ImageSink = {
    folderName,
    nextIndex: 1,
    assetIndex: 0,
    companions: [],
  };
  const chunks: string[] = [];
  for (const block of document.blocks) {
    if (!isRecord(block)) {
      continue;
    }
    renderBlock(block, chunks, sink, assets);
  }
  const body = chunks.join('\n\n');
  const markdown = body.length > 0 ? `${body}\n` : '\n';
  return {
    markdown,
    companions: sink.companions,
  };
}