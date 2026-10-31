import {
  ANIMATION_PIXEL_MAX,
  BLOCK_MAX,
  COLUMN_SHARE_SUM_TOLERANCE,
  LENGTH_DECIMAL_PLACES,
  LETTER_HEIGHT_IN,
  LETTER_WIDTH_IN,
  LINK_SCHEMES,
  STILL_IMAGE_TYPES,
  TABLE_CELL_MAX_CHARS,
  TEXT_AREA_MIN_IN,
  TEXT_MAX_CHARS,
  DRAWING_POINT_MAX,
} from './limits.js';
import { failure, type SchemaFailure } from './result.js';
import type {
  Block,
  BodyInline,
  Document,
  DrawingLayer,
  HeaderInline,
  HeaderParagraph,
  Indents,
  Manifest,
  PageSetup,
  ParagraphBlock,
} from './types.js';
import { characterLength } from './validate.js';

const LINK_SCHEME_SET: ReadonlySet<string> = new Set(LINK_SCHEMES);
const STILL_IMAGE_SET: ReadonlySet<string> = new Set(STILL_IMAGE_TYPES);
const MONTH_LENGTHS = [0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function hasDecimalPlaces(value: number, places: number): boolean {
  const factor = 10 ** places;
  const scaled = value * factor;
  return Math.abs(scaled - Math.round(scaled)) <= 1e-4;
}

function decimalIssue(value: number, path: string): SchemaFailure | null {
  if (hasDecimalPlaces(value, LENGTH_DECIMAL_PLACES)) {
    return null;
  }
  return failure('out-of-range', path, 'Use at most 3 decimal places.');
}

function takeId(ids: Set<string>, id: string, path: string): SchemaFailure | null {
  if (ids.has(id)) {
    return failure('invalid', path, 'Block id is repeated.');
  }
  ids.add(id);
  return null;
}

function indentIssue(indents: Indents, path: string): SchemaFailure | null {
  if (indents.first > 0 && indents.hanging > 0) {
    return failure('invalid', path, 'First-line and hanging indents cannot both be set.');
  }
  return null;
}

function textAreaIssue(page: PageSetup): SchemaFailure | null {
  const portrait = page.orientation === 'portrait';
  const paperWidth = portrait ? LETTER_WIDTH_IN : LETTER_HEIGHT_IN;
  const paperHeight = portrait ? LETTER_HEIGHT_IN : LETTER_WIDTH_IN;
  const textWidth = paperWidth - page.margins.left - page.margins.right;
  const textHeight = paperHeight - page.margins.top - page.margins.bottom;
  if (textWidth < TEXT_AREA_MIN_IN || textHeight < TEXT_AREA_MIN_IN) {
    return failure('out-of-range', '/page/margins', 'The text area must be at least 2 inches.');
  }
  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const issue = decimalIssue(page.margins[side], `/page/margins/${side}`);
    if (issue) {
      return issue;
    }
  }
  return null;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function isRealDateTime(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59) {
    return false;
  }
  const length = month === 2 && isLeapYear(year) ? 29 : MONTH_LENGTHS[month] ?? 0;
  return day <= length;
}

function linkIssue(address: string, path: string): SchemaFailure | null {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return failure('invalid', path, 'Link address is not allowed.');
  }
  const scheme = url.protocol.slice(0, -1);
  if (!LINK_SCHEME_SET.has(scheme)) {
    return failure('invalid', path, 'Link scheme is not allowed.');
  }
  if ((scheme === 'http' || scheme === 'https') && url.hostname.length === 0) {
    return failure('invalid', path, 'Link address is not allowed.');
  }
  if (scheme === 'mailto' && url.pathname.length === 0) {
    return failure('invalid', path, 'Link address is not allowed.');
  }
  return null;
}

function bodyTextLength(content: readonly BodyInline[]): number {
  let total = 0;
  for (const item of content) {
    if (item.type === 'text' || item.type === 'link') {
      total += characterLength(item.text);
    }
  }
  return total;
}

function headerTextLength(content: readonly HeaderInline[]): number {
  let total = 0;
  for (const item of content) {
    if (item.type === 'text') {
      total += characterLength(item.text);
    }
  }
  return total;
}

function inlineIssue(content: readonly BodyInline[], path: string): SchemaFailure | null {
  for (let index = 0; index < content.length; index += 1) {
    const item = content[index];
    if (!item) {
      continue;
    }
    if (item.type === 'link') {
      const issue = linkIssue(item.address, `${path}/${index}/address`);
      if (issue) {
        return issue;
      }
    } else if (item.type === 'dateChip' && !isRealDateTime(item.dateTime)) {
      return failure('invalid', `${path}/${index}/dateTime`, 'Date is not a real date and time.');
    }
  }
  return null;
}

function bodyContentIssue(content: readonly BodyInline[], path: string, maxChars: number): SchemaFailure | null {
  if (bodyTextLength(content) > maxChars) {
    return failure('out-of-range', path, 'Text is longer than the maximum.');
  }
  return inlineIssue(content, path);
}

function headerIssue(header: HeaderParagraph, path: string): SchemaFailure | null {
  const indents = indentIssue(header.indents, `${path}/indents`);
  if (indents) {
    return indents;
  }
  if (headerTextLength(header.content) > TEXT_MAX_CHARS) {
    return failure('out-of-range', `${path}/content`, 'Text is longer than the maximum.');
  }
  return null;
}

function paragraphIssue(block: ParagraphBlock, path: string): SchemaFailure | null {
  const indents = indentIssue(block.indents, `${path}/indents`);
  if (indents) {
    return indents;
  }
  return bodyContentIssue(block.content, `${path}/content`, TEXT_MAX_CHARS);
}

function countBlocks(blocks: readonly Block[]): number {
  let count = 0;
  for (const block of blocks) {
    count += 1;
    if (block.type === 'columns') {
      for (const column of block.columns) {
        count += countBlocks(column.blocks);
      }
    }
  }
  return count;
}

function drawingIssue(drawing: DrawingLayer, path: string): SchemaFailure | null {
  let points = 0;
  for (let strokeIndex = 0; strokeIndex < drawing.strokes.length; strokeIndex += 1) {
    const stroke = drawing.strokes[strokeIndex];
    if (!stroke) {
      continue;
    }
    points += stroke.points.length;
    if (points > DRAWING_POINT_MAX) {
      return failure('out-of-range', `${path}/strokes`, 'Too many points.');
    }
    for (let pointIndex = 0; pointIndex < stroke.points.length; pointIndex += 1) {
      const point = stroke.points[pointIndex];
      if (!point) {
        continue;
      }
      if (point.x < 0 || point.y < 0 || point.x > drawing.width || point.y > drawing.height) {
        return failure(
          'out-of-range',
          `${path}/strokes/${strokeIndex}/points/${pointIndex}`,
          'Point is outside the drawing.',
        );
      }
    }
  }
  return null;
}

function blockIssue(block: Block, path: string, ids: Set<string>): SchemaFailure | null {
  const idIssue = takeId(ids, block.id, `${path}/id`);
  if (idIssue) {
    return idIssue;
  }
  switch (block.type) {
    case 'paragraph':
      return paragraphIssue(block, path);
    case 'heading':
    case 'quote':
      return bodyContentIssue(block.content, `${path}/content`, TEXT_MAX_CHARS);
    case 'list': {
      let total = 0;
      for (let index = 0; index < block.items.length; index += 1) {
        const item = block.items[index];
        if (!item) {
          continue;
        }
        total += bodyTextLength(item.content);
        const issue = inlineIssue(item.content, `${path}/items/${index}/content`);
        if (issue) {
          return issue;
        }
      }
      if (total > TEXT_MAX_CHARS) {
        return failure('out-of-range', `${path}/items`, 'Text is longer than the maximum.');
      }
      return null;
    }
    case 'code':
    case 'divider':
    case 'pageBreak':
      return null;
    case 'table': {
      const columns = block.columnWidths.length;
      for (let index = 0; index < block.columnWidths.length; index += 1) {
        const width = block.columnWidths[index];
        if (width === undefined) {
          continue;
        }
        const issue = decimalIssue(width, `${path}/columnWidths/${index}`);
        if (issue) {
          return issue;
        }
      }
      for (let rowIndex = 0; rowIndex < block.rows.length; rowIndex += 1) {
        const row = block.rows[rowIndex];
        if (!row) {
          continue;
        }
        if (row.cells.length !== columns) {
          return failure('invalid', `${path}/rows/${rowIndex}/cells`, 'Each row must have one cell per column.');
        }
        for (let cellIndex = 0; cellIndex < row.cells.length; cellIndex += 1) {
          const cell = row.cells[cellIndex];
          const cellPath = `${path}/rows/${rowIndex}/cells/${cellIndex}`;
          if (!cell) {
            continue;
          }
          if (cell.kind === 'text') {
            const issue = bodyContentIssue(cell.content, `${cellPath}/content`, TABLE_CELL_MAX_CHARS);
            if (issue) {
              return issue;
            }
          } else if (!cell.source.startsWith('=')) {
            return failure('invalid', `${cellPath}/source`, 'A formula starts with =.');
          }
        }
      }
      return null;
    }
    case 'image': {
      const width = decimalIssue(block.width, `${path}/width`);
      if (width) {
        return width;
      }
      return block.drawing ? drawingIssue(block.drawing, `${path}/drawing`) : null;
    }
    case 'formula':
      return null;
    case 'columns': {
      const sum = block.columns.reduce((total, column) => total + column.share, 0);
      if (Math.abs(sum - 1) > COLUMN_SHARE_SUM_TOLERANCE) {
        return failure('invalid', `${path}/columns`, 'Column shares must add up to 1.');
      }
      for (let columnIndex = 0; columnIndex < block.columns.length; columnIndex += 1) {
        const column = block.columns[columnIndex];
        if (!column) {
          continue;
        }
        for (let blockIndex = 0; blockIndex < column.blocks.length; blockIndex += 1) {
          const nested = column.blocks[blockIndex];
          if (!nested) {
            continue;
          }
          const issue = blockIssue(nested, `${path}/columns/${columnIndex}/blocks/${blockIndex}`, ids);
          if (issue) {
            return issue;
          }
        }
      }
      return null;
    }
    case 'drawing':
      return drawingIssue(block, path);
    case 'signature':
      return decimalIssue(block.width, `${path}/width`);
    case 'diagram':
      return null;
    default: {
      const unexpected: never = block;
      return unexpected;
    }
  }
}

export function checkDocumentRules(document: Document): SchemaFailure | null {
  const area = textAreaIssue(document.page);
  if (area) {
    return area;
  }
  const ids = new Set<string>();
  const headerId = takeId(ids, document.header.id, '/header/id');
  if (headerId) {
    return headerId;
  }
  const footerId = takeId(ids, document.footer.id, '/footer/id');
  if (footerId) {
    return footerId;
  }
  const header = headerIssue(document.header, '/header');
  if (header) {
    return header;
  }
  const footer = headerIssue(document.footer, '/footer');
  if (footer) {
    return footer;
  }
  if (countBlocks(document.blocks) > BLOCK_MAX) {
    return failure('out-of-range', '/blocks', 'Too many blocks.');
  }
  for (let index = 0; index < document.blocks.length; index += 1) {
    const block = document.blocks[index];
    if (!block) {
      continue;
    }
    const issue = blockIssue(block, `/blocks/${index}`, ids);
    if (issue) {
      return issue;
    }
  }
  return null;
}

export function checkManifestRules(manifest: Manifest): SchemaFailure | null {
  const seen = new Set<string>();
  for (let index = 0; index < manifest.images.length; index += 1) {
    const image = manifest.images[index];
    if (!image) {
      continue;
    }
    if (seen.has(image.sha256)) {
      return failure('invalid', `/images/${index}/sha256`, 'Image hash is repeated.');
    }
    seen.add(image.sha256);
    if (STILL_IMAGE_SET.has(image.type) && image.frames !== 1) {
      return failure('out-of-range', `/images/${index}/frames`, 'A still image has one frame.');
    }
    if (image.width * image.height * image.frames > ANIMATION_PIXEL_MAX) {
      return failure('out-of-range', `/images/${index}`, 'The image is over the pixel budget.');
    }
  }
  return null;
}

export function checkImages(document: Document, manifest: Manifest): SchemaFailure | null {
  const available = new Set(manifest.images.map((image) => image.sha256));
  const used = new Set<string>();
  const visit = (block: Block, path: string): SchemaFailure | null => {
    if (block.type === 'image' || block.type === 'signature') {
      used.add(block.sha256);
      if (!available.has(block.sha256)) {
        return failure('invalid', `${path}/sha256`, 'Image is not in the manifest.');
      }
    }
    if (block.type === 'columns') {
      for (let columnIndex = 0; columnIndex < block.columns.length; columnIndex += 1) {
        const column = block.columns[columnIndex];
        if (!column) {
          continue;
        }
        for (let blockIndex = 0; blockIndex < column.blocks.length; blockIndex += 1) {
          const nested = column.blocks[blockIndex];
          if (!nested) {
            continue;
          }
          const issue = visit(nested, `${path}/columns/${columnIndex}/blocks/${blockIndex}`);
          if (issue) {
            return issue;
          }
        }
      }
    }
    return null;
  };
  for (let index = 0; index < document.blocks.length; index += 1) {
    const block = document.blocks[index];
    if (!block) {
      continue;
    }
    const issue = visit(block, `/blocks/${index}`);
    if (issue) {
      return issue;
    }
  }
  for (let index = 0; index < manifest.images.length; index += 1) {
    const image = manifest.images[index];
    if (image && !used.has(image.sha256)) {
      return failure('invalid', `/images/${index}/sha256`, 'Image is not used by a block.');
    }
  }
  return null;
}
