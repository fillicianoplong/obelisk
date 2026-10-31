import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { bannedSpecifiersIn } from '../../../scripts/renderer-import-ban.mjs';
import { generateSources } from '../../../scripts/generate-schema-types.mjs';
import {
  checkDocument,
  checkManifest,
  checkPair,
  documentSchema,
} from '../../../dist/shared/schema/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function id(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function hash(n) {
  return n.toString(16).padStart(64, 'a');
}

function margins(value = 1) {
  return { top: value, right: value, bottom: value, left: value };
}

function indents(overrides = {}) {
  return { left: 0, first: 0, hanging: 0, ...overrides };
}

function paragraphFields(overrides = {}) {
  return {
    align: 'left',
    lineSpacing: 'single',
    spaceBefore: 0,
    spaceAfter: 0,
    indents: indents(),
    ...overrides,
  };
}

function header(n, content = []) {
  return { id: id(n), ...paragraphFields(), content };
}

function minimal(view = 'pageless') {
  return {
    view,
    page: { paper: 'letter', orientation: 'portrait', margins: margins() },
    header: header(1),
    footer: header(2),
    blocks: [],
  };
}

function fullDocument() {
  return {
    view: 'pages',
    page: {
      paper: 'letter',
      orientation: 'landscape',
      margins: { top: 0.25, right: 1.5, bottom: 0.5, left: 0.25 },
    },
    header: header(1, [
      {
        type: 'text',
        text: 'Name',
        marks: { bold: true, italic: true, font: 'Liberation Serif', size: 12, color: '#112233' },
      },
      { type: 'pageField', kind: 'page', format: 'decimal' },
    ]),
    footer: header(2, [{ type: 'pageField', kind: 'pages', format: 'page-of-n' }]),
    blocks: [
      {
        type: 'paragraph',
        id: id(3),
        ...paragraphFields({
          align: 'justify',
          lineSpacing: 'double',
          spaceBefore: 6,
          spaceAfter: 12,
          indents: indents({ left: 0.5, first: 0.25 }),
        }),
        content: [
          {
            type: 'text',
            text: 'Hello',
            marks: { underline: true, strike: true, code: true, superscript: true, highlight: '#FFFF00' },
          },
          { type: 'link', address: 'https://example.com/a', text: 'example' },
          { type: 'inlineFormula', latex: 'x^2' },
          { type: 'dateChip', dateTime: '2027-03-04T21:05', format: 'iso-date' },
          { type: 'text', text: 'sub', marks: { subscript: true } },
        ],
      },
      { type: 'heading', id: id(4), level: 6, content: [{ type: 'text', text: 'Title' }] },
      {
        type: 'list',
        id: id(5),
        style: 'bulleted',
        items: [
          { level: 0, content: [{ type: 'text', text: 'One' }] },
          { level: 5, content: [] },
        ],
      },
      {
        type: 'list',
        id: id(6),
        style: 'numbered',
        items: [{ level: 1, content: [{ type: 'link', address: 'mailto:a@b.c', text: 'mail' }] }],
      },
      {
        type: 'list',
        id: id(7),
        style: 'checklist',
        items: [
          { level: 0, checked: true, content: [{ type: 'text', text: 'Done' }] },
          { level: 2, checked: false, content: [] },
        ],
      },
      { type: 'quote', id: id(8), content: [{ type: 'text', text: 'Quoted' }] },
      { type: 'code', id: id(9), text: 'const x = 1;\n' },
      { type: 'divider', id: id(10) },
      { type: 'pageBreak', id: id(11) },
      {
        type: 'table',
        id: id(12),
        headerRow: true,
        columnWidths: [2.5, 3],
        rows: [
          {
            cells: [
              { kind: 'text', content: [{ type: 'text', text: 'A' }] },
              { kind: 'text', content: [{ type: 'text', text: 'B' }] },
            ],
          },
          {
            cells: [
              { kind: 'formula', source: '=B2*2' },
              { kind: 'text', content: [] },
            ],
          },
        ],
      },
      {
        type: 'image',
        id: id(13),
        sha256: hash(1),
        width: 4.25,
        rotation: 90,
        flipHorizontal: true,
        flipVertical: false,
        alt: 'A chart',
        drawing: {
          width: 10,
          height: 8,
          strokes: [{ points: [{ x: 1, y: 2 }, { x: 3.5, y: 4 }], width: 2, color: '#000000' }],
        },
      },
      { type: 'formula', id: id(14), latex: '\\frac{a}{b}' },
      {
        type: 'columns',
        id: id(15),
        columns: [
          {
            share: 0.5,
            blocks: [{ type: 'paragraph', id: id(16), ...paragraphFields(), content: [{ type: 'text', text: 'Left' }] }],
          },
          { share: 0.5, blocks: [{ type: 'divider', id: id(17) }] },
        ],
      },
      {
        type: 'drawing',
        id: id(18),
        width: 100,
        height: 40,
        strokes: [{ points: [{ x: 0, y: 0 }, { x: 100, y: 40 }], width: 1.5, color: '#ABCDEF' }],
      },
      {
        type: 'signature',
        id: id(19),
        sha256: hash(2),
        line: true,
        width: 2.5,
        labels: ['Ada Lovelace', 'Author'],
        align: 'center',
        blank: false,
      },
      { type: 'diagram', id: id(20), source: 'flowchart LR\n  A-->B' },
    ],
  };
}

function fullManifest() {
  return {
    format: 'obelisk',
    formatVersion: 1,
    writer: '0.1.17.0',
    images: [
      { sha256: hash(1), type: 'png', bytes: 12, width: 8, height: 8, frames: 1 },
      { sha256: hash(2), type: 'gif', bytes: 20, width: 4, height: 4, frames: 2 },
    ],
  };
}

function withChange(change, source = minimal()) {
  const document = structuredClone(source);
  change(document);
  return document;
}

function expectDocumentFail(document, reason, pointer) {
  const result = checkDocument(document);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.reason, reason, `${pointer}: ${result.message}`);
  assert.equal(result.path, pointer);
}

test('a valid format 1 document passes', () => {
  for (const view of ['pages', 'pageless']) {
    const result = checkDocument(minimal(view));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.value.view, view);
  }
  const wide = minimal();
  wide.page.margins = margins(3);
  assert.equal(checkDocument(wide).ok, true);
  const full = checkDocument(fullDocument());
  assert.equal(full.ok, true, JSON.stringify(full));
  const paired = checkPair(fullDocument(), fullManifest());
  assert.equal(paired.ok, true, JSON.stringify(paired));
  const thirds = minimal();
  thirds.blocks = [{
    type: 'columns',
    id: id(3),
    columns: [
      { share: 0.333, blocks: [] },
      { share: 0.333, blocks: [] },
      { share: 0.334, blocks: [] },
    ],
  }];
  assert.equal(checkDocument(thirds).ok, true, JSON.stringify(checkDocument(thirds)));
});

test('a document with an unknown field fails', () => {
  const cases = [
    [(document) => { document.author = 'x'; }, '/author'],
    [(document) => { document.page.size = 8.5; }, '/page/size'],
    [(document) => { document.header.marks = {}; }, '/header/marks'],
    [(document) => { document.blocks = [{ type: 'divider', id: id(3), extra: true }]; }, '/blocks/0/extra'],
    [(document) => {
      document.blocks = [{
        type: 'paragraph',
        id: id(3),
        ...paragraphFields(),
        content: [{ type: 'text', text: 'Hi', marks: { bold: true, weight: 700 } }],
      }];
    }, '/blocks/0/content/0/marks/weight'],
    [(document) => { document.blocks = [{ type: 'code', id: id(3), text: 'x', marks: [] }]; }, '/blocks/0/marks'],
  ];
  for (const [change, pointer] of cases) {
    expectDocumentFail(withChange(change), 'unknown-field', pointer);
  }
});

test('a document with a wrong type fails', () => {
  const cases = [
    [(document) => { document.view = 1; }, '/view'],
    [(document) => { document.page = 'letter'; }, '/page'],
    [(document) => { document.blocks = {}; }, '/blocks'],
    [(document) => { document.header = []; }, '/header'],
    [(document) => { document.footer = null; }, '/footer'],
    [(document) => { document.page.margins.top = '1'; }, '/page/margins/top'],
    [(document) => { document.blocks = [1]; }, '/blocks/0'],
    [(document) => { document.blocks = [{ type: 'heading', id: id(3), level: '1', content: [] }]; }, '/blocks/0/level'],
    [(document) => { document.blocks = [{ type: 'heading', id: id(3), level: 1.5, content: [] }]; }, '/blocks/0/level'],
    [(document) => {
      document.blocks = [{ type: 'image', id: id(3), sha256: hash(1), width: 1, rotation: 0, flipHorizontal: 'yes', flipVertical: false, alt: '' }];
    }, '/blocks/0/flipHorizontal'],
    [(document) => { document.page.orientation = false; }, '/page/orientation'],
    [(document) => { document.page.margins.top = Number.NaN; }, '/page/margins/top'],
    [(document) => { document.page.margins.top = Number.POSITIVE_INFINITY; }, '/page/margins/top'],
  ];
  for (const [change, pointer] of cases) {
    expectDocumentFail(withChange(change), 'wrong-type', pointer);
  }
});

test('a document with an out-of-range value fails', () => {
  const cases = [
    [(document) => { document.view = 'Pages'; }, '/view'],
    [(document) => { document.page.paper = 'a4'; }, '/page/paper'],
    [(document) => { document.page.orientation = 'Portrait'; }, '/page/orientation'],
    [(document) => { document.page.margins.top = 0.2; }, '/page/margins/top'],
    [(document) => { document.page.margins.left = 3.001; }, '/page/margins/left'],
    [(document) => { document.page.margins.top = 1.0001; }, '/page/margins/top'],
    [(document) => { document.header.align = 'start'; }, '/header/align'],
    [(document) => { document.header.lineSpacing = '1.2'; }, '/header/lineSpacing'],
    [(document) => { document.header.spaceBefore = 3; }, '/header/spaceBefore'],
    [(document) => { document.header.indents.left = 0.3; }, '/header/indents/left'],
    [(document) => { document.header.indents.left = 3.25; }, '/header/indents/left'],
    [(document) => { document.header.indents.first = 1.25; }, '/header/indents/first'],
    [(document) => { document.blocks = [{ type: 'heading', id: id(3), level: 0, content: [] }]; }, '/blocks/0/level'],
    [(document) => { document.blocks = [{ type: 'heading', id: id(3), level: 7, content: [] }]; }, '/blocks/0/level'],
    [(document) => { document.blocks = [{ type: 'html', id: id(3) }]; }, '/blocks/0/type'],
    [(document) => { document.blocks = [{ type: 'list', id: id(3), style: 'bulleted', items: [{ level: 6, content: [] }] }]; }, '/blocks/0/items/0/level'],
    [(document) => { document.blocks = [{ type: 'list', id: id(3), style: 'squares', items: [] }]; }, '/blocks/0/style'],
    [(document) => {
      document.blocks = [{
        type: 'paragraph',
        id: id(3),
        ...paragraphFields(),
        content: [{ type: 'text', text: 'Hi', marks: { size: 13 } }],
      }];
    }, '/blocks/0/content/0/marks/size'],
    [(document) => {
      document.blocks = [{
        type: 'paragraph',
        id: id(3),
        ...paragraphFields(),
        content: [{ type: 'text', text: 'Hi', marks: { font: 'A'.repeat(65) } }],
      }];
    }, '/blocks/0/content/0/marks/font'],
    [(document) => {
      document.blocks = [{
        type: 'paragraph',
        id: id(3),
        ...paragraphFields(),
        content: [{ type: 'text', text: 'Hi', marks: { font: '' } }],
      }];
    }, '/blocks/0/content/0/marks/font'],
    [(document) => {
      document.blocks = [{
        type: 'paragraph',
        id: id(3),
        ...paragraphFields(),
        content: [{ type: 'text', text: 'x'.repeat(100_001) }],
      }];
    }, '/blocks/0/content/0/text'],
    [(document) => {
      document.blocks = [{
        type: 'paragraph',
        id: id(3),
        ...paragraphFields(),
        content: [{ type: 'link', address: `https://example.com/${'a'.repeat(2048)}`, text: 'x' }],
      }];
    }, '/blocks/0/content/0/address'],
    [(document) => {
      document.blocks = [{
        type: 'paragraph',
        id: id(3),
        ...paragraphFields(),
        content: [{ type: 'inlineFormula', latex: 'x'.repeat(10_001) }],
      }];
    }, '/blocks/0/content/0/latex'],
    [(document) => { document.blocks = [{ type: 'code', id: id(3), text: 'x'.repeat(100_001) }]; }, '/blocks/0/text'],
    [(document) => { document.blocks = [{ type: 'formula', id: id(3), latex: 'x'.repeat(10_001) }]; }, '/blocks/0/latex'],
    [(document) => { document.blocks = [{ type: 'diagram', id: id(3), source: 'x'.repeat(50_001) }]; }, '/blocks/0/source'],
    [(document) => { document.blocks = [{ type: 'image', id: id(3), sha256: hash(1), width: 0, rotation: 0, flipHorizontal: false, flipVertical: false, alt: '' }]; }, '/blocks/0/width'],
    [(document) => { document.blocks = [{ type: 'image', id: id(3), sha256: hash(1), width: 11.001, rotation: 0, flipHorizontal: false, flipVertical: false, alt: '' }]; }, '/blocks/0/width'],
    [(document) => { document.blocks = [{ type: 'image', id: id(3), sha256: hash(1), width: 1, rotation: 45, flipHorizontal: false, flipVertical: false, alt: '' }]; }, '/blocks/0/rotation'],
    [(document) => { document.blocks = [{ type: 'image', id: id(3), sha256: hash(1), width: 1, rotation: 0, flipHorizontal: false, flipVertical: false, alt: 'x'.repeat(501) }]; }, '/blocks/0/alt'],
    [(document) => { document.blocks = [{ type: 'signature', id: id(3), sha256: hash(1), line: false, width: 1.4, labels: [], align: 'left', blank: false }]; }, '/blocks/0/width'],
    [(document) => { document.blocks = [{ type: 'signature', id: id(3), sha256: hash(1), line: false, width: 4.1, labels: [], align: 'left', blank: false }]; }, '/blocks/0/width'],
    [(document) => { document.blocks = [{ type: 'signature', id: id(3), sha256: hash(1), line: false, width: 2, labels: ['a', 'b', 'c'], align: 'left', blank: false }]; }, '/blocks/0/labels'],
    [(document) => { document.blocks = [{ type: 'signature', id: id(3), sha256: hash(1), line: false, width: 2, labels: ['x'.repeat(101)], align: 'left', blank: false }]; }, '/blocks/0/labels/0'],
    [(document) => { document.blocks = [{ type: 'table', id: id(3), headerRow: false, columnWidths: Array(27).fill(1), rows: [{ cells: [{ kind: 'text', content: [] }] }] }]; }, '/blocks/0/columnWidths'],
    [(document) => { document.blocks = [{ type: 'table', id: id(3), headerRow: false, columnWidths: [1], rows: Array(201).fill({ cells: [{ kind: 'text', content: [] }] }) }]; }, '/blocks/0/rows'],
    [(document) => { document.blocks = [{ type: 'columns', id: id(3), columns: [{ share: 1, blocks: [] }] }]; }, '/blocks/0/columns'],
    [(document) => { document.blocks = [{ type: 'columns', id: id(3), columns: Array(5).fill({ share: 0.2, blocks: [] }) }]; }, '/blocks/0/columns'],
    [(document) => { document.blocks = [{ type: 'columns', id: id(3), columns: [{ share: 0.1, blocks: [] }, { share: 0.9, blocks: [] }] }]; }, '/blocks/0/columns/0/share'],
    [(document) => { document.blocks = [{ type: 'drawing', id: id(3), width: 0, height: 10, strokes: [] }]; }, '/blocks/0/width'],
    [(document) => { document.blocks = [{ type: 'drawing', id: id(3), width: 8001, height: 10, strokes: [] }]; }, '/blocks/0/width'],
    [(document) => { document.blocks = [{ type: 'drawing', id: id(3), width: 10, height: 10, strokes: Array(2001) }]; }, '/blocks/0/strokes'],
    [(document) => {
      document.blocks = [{
        type: 'drawing',
        id: id(3),
        width: 10,
        height: 10,
        strokes: [{ points: Array(100_001), width: 1, color: '#000000' }],
      }];
    }, '/blocks/0/strokes/0/points'],
    [(document) => { document.blocks = Array.from({ length: 20_001 }, (_, index) => ({ type: 'divider', id: id(index + 3) })); }, '/blocks'],
  ];
  for (const [change, pointer] of cases) {
    expectDocumentFail(withChange(change), 'out-of-range', pointer);
  }
});

test('the view, Pages or Pageless, is required', () => {
  const missing = minimal();
  delete missing.view;
  expectDocumentFail(missing, 'missing-field', '/view');
  expectDocumentFail(withChange((document) => { document.view = ''; }), 'out-of-range', '/view');
  for (const view of ['pages', 'pageless']) {
    assert.equal(checkDocument(minimal(view)).ok, true);
  }
});

test('cross-field format rules fail closed', () => {
  const cases = [
    [(document) => { document.header.indents.first = 0.25; document.header.indents.hanging = 0.25; }, 'invalid', '/header/indents'],
    [(document) => { document.footer.id = document.header.id; }, 'invalid', '/footer/id'],
    [(document) => {
      document.blocks = [
        { type: 'divider', id: id(3) },
        { type: 'divider', id: id(3) },
      ];
    }, 'invalid', '/blocks/1/id'],
    [(document) => {
      document.blocks = [{
        type: 'paragraph',
        id: id(3),
        ...paragraphFields(),
        content: [
          { type: 'text', text: 'a'.repeat(60_000) },
          { type: 'text', text: 'b'.repeat(60_000) },
        ],
      }];
    }, 'out-of-range', '/blocks/0/content'],
    [(document) => {
      document.blocks = [{
        type: 'paragraph',
        id: id(3),
        ...paragraphFields(),
        content: [{ type: 'link', address: 'javascript:alert(1)', text: 'x' }],
      }];
    }, 'invalid', '/blocks/0/content/0/address'],
    [(document) => {
      document.blocks = [{
        type: 'paragraph',
        id: id(3),
        ...paragraphFields(),
        content: [{ type: 'link', address: 'file:///C:/Windows', text: 'x' }],
      }];
    }, 'invalid', '/blocks/0/content/0/address'],
    [(document) => {
      document.blocks = [{
        type: 'paragraph',
        id: id(3),
        ...paragraphFields(),
        content: [{ type: 'dateChip', dateTime: '2027-02-29T00:00', format: 'iso-date' }],
      }];
    }, 'invalid', '/blocks/0/content/0/dateTime'],
    [(document) => {
      document.blocks = [{
        type: 'paragraph',
        id: id(3),
        ...paragraphFields(),
        content: [{ type: 'pageField', kind: 'page', format: 'decimal' }],
      }];
    }, 'out-of-range', '/blocks/0/content/0/type'],
    [(document) => {
      document.header.content = [{ type: 'link', address: 'https://example.com', text: 'x' }];
    }, 'out-of-range', '/header/content/0/type'],
    [(document) => {
      document.blocks = [{ type: 'list', id: id(3), style: 'bulleted', items: [{ level: 0, checked: true, content: [] }] }];
    }, 'unknown-field', '/blocks/0/items/0/checked'],
    [(document) => {
      document.blocks = [{ type: 'list', id: id(3), style: 'checklist', items: [{ level: 0, content: [] }] }];
    }, 'missing-field', '/blocks/0/items/0/checked'],
    [(document) => {
      document.blocks = [{
        type: 'table',
        id: id(3),
        headerRow: false,
        columnWidths: [1, 2],
        rows: [{ cells: [{ kind: 'text', content: [] }] }],
      }];
    }, 'invalid', '/blocks/0/rows/0/cells'],
    [(document) => {
      document.blocks = [{
        type: 'table',
        id: id(3),
        headerRow: false,
        columnWidths: [1],
        rows: [{ cells: [{ kind: 'text', content: [{ type: 'text', text: 'x'.repeat(10_001) }] }] }],
      }];
    }, 'out-of-range', '/blocks/0/rows/0/cells/0/content'],
    [(document) => {
      document.blocks = [{
        type: 'table',
        id: id(3),
        headerRow: false,
        columnWidths: [1],
        rows: [{ cells: [{ kind: 'formula', source: 'B2' }] }],
      }];
    }, 'invalid', '/blocks/0/rows/0/cells/0/source'],
    [(document) => {
      document.blocks = [{
        type: 'columns',
        id: id(3),
        columns: [
          { share: 0.4, blocks: [] },
          { share: 0.4, blocks: [] },
        ],
      }];
    }, 'invalid', '/blocks/0/columns'],
    [(document) => {
      document.blocks = [{
        type: 'columns',
        id: id(3),
        columns: [
          { share: 0.5, blocks: [{ type: 'pageBreak', id: id(4) }] },
          { share: 0.5, blocks: [] },
        ],
      }];
    }, 'out-of-range', '/blocks/0/columns/0/blocks/0/type'],
    [(document) => {
      document.blocks = [{
        type: 'columns',
        id: id(3),
        columns: [
          { share: 0.5, blocks: [{ type: 'columns', id: id(4), columns: [] }] },
          { share: 0.5, blocks: [] },
        ],
      }];
    }, 'out-of-range', '/blocks/0/columns/0/blocks/0/type'],
    [(document) => {
      document.blocks = [{
        type: 'drawing',
        id: id(3),
        width: 10,
        height: 10,
        strokes: [{ points: [{ x: 11, y: 0 }], width: 1, color: '#000000' }],
      }];
    }, 'out-of-range', '/blocks/0/strokes/0/points/0'],
    [(document) => { document.blocks = [{ type: 'divider', id: '00000000-0000-4000-8000-00000000000G' }]; }, 'invalid', '/blocks/0/id'],
    [(document) => { document.blocks = [{ type: 'image', id: id(3), sha256: 'A'.repeat(64), width: 1, rotation: 0, flipHorizontal: false, flipVertical: false, alt: '' }]; }, 'invalid', '/blocks/0/sha256'],
    [(document) => {
      document.blocks = [{
        type: 'paragraph',
        id: id(3),
        ...paragraphFields(),
        content: [{ type: 'text', text: 'a\uD800b' }],
      }];
    }, 'invalid', '/blocks/0/content/0/text'],
  ];
  for (const [change, reason, pointer] of cases) {
    expectDocumentFail(withChange(change), reason, pointer);
  }

  const nested = minimal();
  nested.blocks = [{
    type: 'columns',
    id: id(3),
    columns: [
      { share: 0.5, blocks: Array.from({ length: 20_000 }, (_, index) => ({ type: 'divider', id: id(index + 10) })) },
      { share: 0.5, blocks: [] },
    ],
  }];
  expectDocumentFail(nested, 'out-of-range', '/blocks');
});

test('manifest images stay inside the format limits and match the document', () => {
  assert.equal(checkManifest({ format: 'obelisk', formatVersion: 1, writer: '1.0.0', images: [] }).ok, true);
  const manifest = fullManifest();
  manifest.images.push({ sha256: hash(1), type: 'png', bytes: 4, width: 1, height: 1, frames: 1 });
  const repeated = checkManifest(manifest);
  assert.equal(repeated.ok, false);
  assert.equal(repeated.reason, 'invalid');
  assert.equal(repeated.path, '/images/2/sha256');

  const still = fullManifest();
  still.images[0].frames = 2;
  const frames = checkManifest(still);
  assert.equal(frames.ok, false);
  assert.equal(frames.reason, 'out-of-range');
  assert.equal(frames.path, '/images/0/frames');

  const budget = {
    format: 'obelisk',
    formatVersion: 1,
    writer: '1.0.0',
    images: [{ sha256: hash(1), type: 'webp', bytes: 10, width: 8000, height: 8000, frames: 4 }],
  };
  const pixels = checkManifest(budget);
  assert.equal(pixels.ok, false);
  assert.equal(pixels.reason, 'out-of-range');
  assert.equal(pixels.path, '/images/0');

  const unknown = fullManifest();
  unknown.note = true;
  const extra = checkManifest(unknown);
  assert.equal(extra.ok, false);
  assert.equal(extra.reason, 'unknown-field');

  const missing = checkPair(fullDocument(), { format: 'obelisk', formatVersion: 1, writer: '1.0.0', images: [] });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'invalid');
  assert.equal(missing.path, '/blocks/10/sha256');

  const unused = checkPair(minimal(), fullManifest());
  assert.equal(unused.ok, false);
  assert.equal(unused.reason, 'invalid');
  assert.equal(unused.path, '/images/0/sha256');
});

function lf(text) {
  return text.replaceAll('\r\n', '\n');
}

test('generated types and the schema module match document.schema.json', async () => {
  const schemaPath = path.join(root, 'src/shared/schema/document.schema.json');
  const schemaText = await readFile(schemaPath, 'utf8');
  const schema = JSON.parse(schemaText);
  const { typesSource, dataSource } = generateSources(schema);
  assert.equal(lf(await readFile(path.join(root, 'src/shared/schema/types.ts'), 'utf8')), lf(typesSource));
  assert.equal(lf(await readFile(path.join(root, 'src/shared/schema/schema-data.ts'), 'utf8')), lf(dataSource));
  assert.deepEqual(documentSchema, schema);

  const files = (await readdir(path.join(root, 'src/shared/schema'))).filter((name) => name.endsWith('.ts'));
  assert.ok(files.length > 0);
  for (const name of files) {
    const source = await readFile(path.join(root, 'src/shared/schema', name), 'utf8');
    assert.deepEqual(bannedSpecifiersIn(source), [], name);
  }
});
