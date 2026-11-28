import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildMarkdownExport } from '../../../dist/main/export/markdown/write.js';
import { createExportService } from '../../../dist/main/export/service.js';
import { escapeMarkdownText, prepareExportText } from '../../../dist/main/export/markdown/escape.js';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const GIF_ANIMATED = Buffer.from(
  'R0lGODlhAQABAIAAAP///////yH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==',
  'base64',
);

function id(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function pagelessDoc(blocks) {
  return {
    view: 'pageless',
    page: { paper: 'letter', orientation: 'portrait', margins: { top: 1, right: 1, bottom: 1, left: 1 } },
    header: { id: id(1), align: 'left', lineSpacing: 'single', spaceBefore: 0, spaceAfter: 0, indents: { left: 0, first: 0, hanging: 0 }, content: [] },
    footer: { id: id(2), align: 'left', lineSpacing: 'single', spaceBefore: 0, spaceAfter: 0, indents: { left: 0, first: 0, hanging: 0 }, content: [] },
    blocks,
  };
}

test('H-26 export text, alt text, and link text are escaped for Markdown', () => {
  const controls = [0x00, 0x01, 0x08, 0x0b, 0x0c, 0x0e, 0x1f, 0x7f]
    .map((code) => String.fromCharCode(code))
    .join('');
  const sample = `a<b>&c]]>d${controls}\uD800x\uDC00`;
  const escaped = escapeMarkdownText(sample);
  assert.match(escaped, /\\</);
  assert.match(escaped, /\\&/);
  assert.match(escaped, /\\\]\\\]\\>/);
  assert.equal(escaped.includes('\u0000'), false);
  assert.equal(escaped.includes('\uD800'), false);
  assert.match(escaped, /a\\<b\\>\\&c/);
  const cleaned = prepareExportText(sample);
  assert.equal(cleaned.includes('\u0000'), false);
  assert.equal(cleaned.includes('\uD800'), false);
});

test('AC-12 Markdown export maps blocks, images, tables, and alt text', async () => {
  const document = pagelessDoc([
    { type: 'heading', id: id(3), level: 1, content: [{ type: 'text', text: 'Report' }] },
    { type: 'paragraph', id: id(4), align: 'left', lineSpacing: 'single', spaceBefore: 0, spaceAfter: 0, indents: { left: 0, first: 0, hanging: 0 }, content: [{ type: 'text', text: 'Intro' }] },
    {
      type: 'table',
      id: id(5),
      headerRow: true,
      columnWidths: [2, 2],
      rows: [
        { cells: [{ kind: 'text', content: [{ type: 'text', text: 'A' }] }, { kind: 'text', content: [{ type: 'text', text: 'B' }] }] },
        { cells: [{ kind: 'text', content: [{ type: 'text', text: '1' }] }, { kind: 'text', content: [{ type: 'text', text: '2' }] }] },
      ],
    },
    {
      type: 'image',
      id: id(6),
      sha256: 'a'.repeat(64),
      width: 2,
      rotation: 0,
      flipHorizontal: false,
      flipVertical: false,
      alt: 'Red square',
    },
    { type: 'formula', id: id(7), latex: '\\frac{1}{2}' },
  ]);
  const assets = {
    mathml: [],
    formulaPngs: [],
    firstFramePngs: [],
    images: [PNG_1X1.toString('base64')],
  };
  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-md-export-'));
  const mdPath = path.join(directory, 'Report.md');
  try {
    const built = buildMarkdownExport(document, assets, mdPath);
    assert.match(built.markdown, /^# Report/);
    assert.match(built.markdown, /\| A \| B \|/);
    assert.match(built.markdown, /!\[Red square\]\(Report_images\/image-001\.png\)/);
    assert.match(built.markdown, /\$\$[\s\S]*\\frac\{1\}\{2\}/);
    assert.equal(built.companions.length, 1);
    assert.equal(built.companions[0].relativePath, 'Report_images/image-001.png');
    const service = createExportService({
      showExportDialog: async () => ({ canceled: false, filePath: mdPath }),
      lookupHandle: () => null,
      documentsDirectory: () => directory,
      platform: 'linux',
    });
    const result = await service.run({ format: 'markdown', handle: null, document, assets });
    assert.equal(result.status, 'ok');
    const written = await readFile(mdPath, 'utf8');
    assert.equal(written, built.markdown);
    const imagePath = path.join(directory, 'Report_images', 'image-001.png');
    assert.deepEqual(await readFile(imagePath), PNG_1X1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('moving the Markdown file and images folder keeps relative links working', async () => {
  const document = pagelessDoc([
    {
      type: 'image',
      id: id(8),
      sha256: 'b'.repeat(64),
      width: 2,
      rotation: 0,
      flipHorizontal: false,
      flipVertical: false,
      alt: 'Still',
    },
  ]);
  const assets = {
    mathml: [],
    formulaPngs: [],
    firstFramePngs: [],
    images: [PNG_1X1.toString('base64')],
  };
  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-md-move-'));
  const mdPath = path.join(directory, 'Notes.md');
  try {
    const service = createExportService({
      showExportDialog: async () => ({ canceled: false, filePath: mdPath }),
      lookupHandle: () => null,
      documentsDirectory: () => directory,
      platform: 'linux',
    });
    const exported = await service.run({ format: 'markdown', handle: null, document, assets });
    assert.equal(exported.status, 'ok');
    const movedRoot = path.join(directory, 'moved');
    await mkdir(movedRoot, { recursive: true });
    await rename(mdPath, path.join(movedRoot, 'Notes.md'));
    await rename(path.join(directory, 'Notes_images'), path.join(movedRoot, 'Notes_images'));
    const md = await readFile(path.join(movedRoot, 'Notes.md'), 'utf8');
    const rel = 'Notes_images/image-001.png';
    assert.match(md, new RegExp(`\\]\\(${rel.replaceAll('.', '\\.')}\\)`));
    await readFile(path.join(movedRoot, rel));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('AC-30 animated GIF is kept in the Markdown images folder', () => {
  const document = pagelessDoc([
    {
      type: 'image',
      id: id(9),
      sha256: 'c'.repeat(64),
      width: 2,
      rotation: 0,
      flipHorizontal: false,
      flipVertical: false,
      alt: 'Spinner',
    },
  ]);
  const assets = {
    mathml: [],
    formulaPngs: [],
    firstFramePngs: [],
    images: [GIF_ANIMATED.toString('base64')],
  };
  const built = buildMarkdownExport(document, assets, '/tmp/Spin.md');
  assert.match(built.markdown, /image-001\.gif/);
  assert.deepEqual(Buffer.from(built.companions[0].bytes), GIF_ANIMATED);
  assert.equal(String.fromCharCode(built.companions[0].bytes[0], built.companions[0].bytes[1], built.companions[0].bytes[2]), 'GIF');
});