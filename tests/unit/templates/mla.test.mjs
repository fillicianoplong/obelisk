import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadRenderer } from '../editor/load-renderer.mjs';
import { checkDocument } from '../../../dist/shared/schema/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const mlaUrl = new URL('../../../src/templates/mla/document.ts', import.meta.url);
const referenceUrl = new URL('../../../src/templates/mla/reference.ts', import.meta.url);
const modelUrl = new URL('../../../src/renderer/shell/tabs/model.ts', import.meta.url);
const applyUrl = new URL('../../../src/renderer/shell/menus/apply.ts', import.meta.url);
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);

function blockId(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function section(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return text.slice(from, to);
}

test('the MLA template reference in the SRS matches the checker constants', async () => {
  const srs = await readFile(path.join(root, 'docs/SRS.md'), 'utf8');
  const mla = section(srs, '### MLA template reference', '### Paste reference');
  assert.match(mla, /Margins \| 1 in on all sides/);
  assert.match(mla, /Font \| Liberation Serif, 12 pt/);
  assert.match(mla, /Line spacing \| Double, everywhere, with no extra space before or after/);
  assert.match(mla, /Header \| Right-aligned: last name, a space, and the page number/);
  assert.match(mla, /Heading lines \| Four left-aligned placeholder lines: name, instructor, course, date/);
  assert.match(mla, /Title \| Centered placeholder line, no bold or underline/);
  assert.match(mla, /Body \| First-line indent 0\.5 in/);
  assert.match(mla, /Works Cited \| New page, centered title, hanging indent 0\.5 in/);

  const { MLA_TEMPLATE_REFERENCE } = await loadRenderer(referenceUrl);
  assert.equal(MLA_TEMPLATE_REFERENCE.length, 8);
});

test('createMlaDocument passes AC-09 inspection for font, spacing, header, and indents', async () => {
  const { createMlaDocument } = await loadRenderer(mlaUrl);
  const { inspectMlaDocument, mlaDocumentMatchesReference } = await loadRenderer(referenceUrl);

  let n = 0;
  const built = createMlaDocument(() => blockId(++n));
  const checked = checkDocument(built.document);
  assert.equal(checked.ok, true, checked.ok ? '' : JSON.stringify(checked));

  assert.equal(mlaDocumentMatchesReference(built.document), true);
  const issues = inspectMlaDocument(built.document);
  assert.deepEqual(issues, []);
});

test('createMlaTab opens a new tab with the MLA document (FR-27)', async () => {
  const { createMlaTab } = await loadRenderer(modelUrl);
  const { mlaDocumentMatchesReference } = await loadRenderer(referenceUrl);
  const tab = createMlaTab(1);
  assert.equal(tab.title, 'Untitled 1');
  assert.equal(tab.baseDocument.view, 'pages');
  assert.equal(tab.savedView, 'pages');
  assert.equal(tab.savedPage.margins.top, 1);
  assert.equal(mlaDocumentMatchesReference(tab.baseDocument), true);
  assert.equal(tab.editor.doc.textContent.includes('Works Cited'), true);
});

test('File > New from template > MLA is always enabled', async () => {
  const { liveMenus } = await loadRenderer(applyUrl);
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const state = createTabEditorState();
  const menus = liveMenus({
    documentTab: false,
    selectionEmpty: true,
    editorState: null,
    documentView: 'pages',
  });
  const file = menus.find((menu) => menu.id === 'file');
  const template = file.entries.find((entry) => entry.id === 'file-template');
  assert.equal(template.enabled, true);
  const mla = template.submenu.find((entry) => entry.id === 'file-template-mla');
  assert.equal(mla.enabled, true);
  assert.equal(mla.command, 'new-mla');

  const active = liveMenus({
    documentTab: true,
    selectionEmpty: true,
    editorState: state,
    documentView: 'pages',
  });
  const mlaActive = active
    .find((menu) => menu.id === 'file')
    .entries.find((entry) => entry.id === 'file-template')
    .submenu.find((entry) => entry.id === 'file-template-mla');
  assert.equal(mlaActive.enabled, true);
});