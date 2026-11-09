import { writeFile } from 'node:fs/promises';
import { encodeObk } from '../dist/main/codec/encode/index.js';

const file = process.argv[2];
const text = process.argv[3];
if (!file || typeof text !== 'string' || text.length < 1) {
  console.error('Usage: write-package-io-fixture.mjs <file> <text>');
  process.exit(1);
}

function blockId(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function fields(n) {
  return {
    id: blockId(n),
    align: 'left',
    lineSpacing: 'single',
    spaceBefore: 0,
    spaceAfter: 0,
    indents: { left: 0, first: 0, hanging: 0 },
  };
}

const document = {
  view: 'pageless',
  page: {
    paper: 'letter',
    orientation: 'portrait',
    margins: { top: 1, right: 1, bottom: 1, left: 1 },
  },
  header: { ...fields(1), content: [] },
  footer: { ...fields(2), content: [] },
  blocks: [{
    type: 'paragraph',
    ...fields(3),
    content: [{ type: 'text', text }],
  }],
};

const encoded = await encodeObk(document, {
  format: 'obelisk',
  formatVersion: 1,
  writer: 'obelisk',
  images: [],
});
if (!encoded.ok) {
  console.error(encoded.message);
  process.exit(1);
}
await writeFile(file, encoded.bytes);
