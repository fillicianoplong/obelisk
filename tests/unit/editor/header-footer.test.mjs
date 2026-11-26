import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRenderer } from '../editor/load-renderer.mjs';

const fieldUrl = new URL('../../../src/renderer/editor/header/page-field.ts', import.meta.url);
const mappingUrl = new URL('../../../src/renderer/editor/header/mapping.ts', import.meta.url);
const modelUrl = new URL('../../../src/renderer/shell/tabs/model.ts', import.meta.url);
const applyUrl = new URL('../../../src/renderer/shell/menus/apply.ts', import.meta.url);
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);

test('page fields show each page number, roman numerals, page of n, and the page count', async () => {
  const { pageFieldText, romanNumeral, reservedMarginIn } = await loadRenderer(fieldUrl);
  assert.equal(pageFieldText('page', 'decimal', 1, 3), '1');
  assert.equal(pageFieldText('page', 'decimal', 2, 3), '2');
  assert.equal(pageFieldText('page', 'decimal', 3, 3), '3');
  assert.equal(romanNumeral(1), 'i');
  assert.equal(romanNumeral(2), 'ii');
  assert.equal(romanNumeral(4), 'iv');
  assert.equal(pageFieldText('page', 'roman', 3, 4), 'iii');
  assert.equal(pageFieldText('page', 'page-of-n', 1, 4), 'Page 1 of 4');
  assert.equal(pageFieldText('page', 'page-of-n', 2, 4), 'Page 2 of 4');
  assert.equal(pageFieldText('pages', 'decimal', 2, 4), '4');
  assert.equal(reservedMarginIn(1, 0, 100), 1);
  assert.equal(reservedMarginIn(0.5, 0, 100), 0.5);
  const narrow = reservedMarginIn(0.5, 20, 100);
  assert.ok(narrow > 0.5, `narrow body should move below the header, got ${narrow}`);
  assert.equal(reservedMarginIn(1, 20, 100), 1);
});

test('a header paragraph round-trips text and page fields', async () => {
  const { headerDocFromParagraph, paragraphFromHeaderDoc } = await loadRenderer(mappingUrl);
  const source = {
    id: '00000000-0000-4000-8000-000000000010',
    align: 'right',
    lineSpacing: 'single',
    spaceBefore: 0,
    spaceAfter: 0,
    indents: { left: 0, first: 0, hanging: 0 },
    content: [
      { type: 'text', text: 'Plong ' },
      { type: 'pageField', kind: 'page', format: 'decimal' },
    ],
  };
  const doc = headerDocFromParagraph(source);
  assert.equal(doc.childCount, 1);
  const back = paragraphFromHeaderDoc(doc, source);
  assert.equal(back.align, 'right');
  assert.equal(back.content.length, 2);
  assert.equal(back.content[0].text, 'Plong ');
  assert.equal(back.content[1].type, 'pageField');
  assert.equal(back.content[1].kind, 'page');
  assert.equal(back.content[1].format, 'decimal');
});

test('editing the header marks the tab changed and the same header does not', async () => {
  const { createTab, tabHasUnsavedChanges, withBand } = await loadRenderer(modelUrl);
  const tab = createTab(1);
  assert.equal(tabHasUnsavedChanges(tab), false);
  const next = withBand(tab, 'header', {
    ...tab.baseDocument.header,
    content: [{ type: 'text', text: 'Plong' }],
  });
  assert.notEqual(next, tab);
  assert.equal(tabHasUnsavedChanges(next), true);
  assert.equal(next.baseDocument.header.content[0].text, 'Plong');
  assert.equal(next.baseDocument.footer, tab.baseDocument.footer);
  const back = withBand(next, 'header', tab.savedHeader);
  assert.equal(tabHasUnsavedChanges(back), false);
});

test('Header and footer is disabled in Pageless and page fields are enabled only while editing', async () => {
  const { liveMenus } = await loadRenderer(applyUrl);
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const state = createTabEditorState();
  function item(view, bandEditing, id) {
    const menus = liveMenus({
      documentTab: true,
      selectionEmpty: true,
      editorState: state,
      documentView: view,
      bandEditing,
    });
    const menu = menus.find((entry) => entry.id === (id.startsWith('format-') ? 'format' : 'insert'));
    const found = menu.entries.find((entry) => entry.id === id);
    return found;
  }
  assert.equal(item('pages', false, 'format-header').enabled, true);
  assert.equal(item('pageless', false, 'format-header').enabled, false);
  assert.equal(item('pageless', false, 'format-page-setup').enabled, false);
  assert.equal(item('pages', false, 'format-page-setup').enabled, true);
  assert.equal(item('pages', false, 'insert-page-count').enabled, false);
  assert.equal(item('pages', true, 'insert-page-count').enabled, true);
  assert.equal(item('pages', true, 'insert-page-number').enabled, true);
  const number = item('pages', true, 'insert-page-number');
  assert.equal(number.submenu.find((entry) => entry.id === 'insert-page-number-roman').enabled, true);
  assert.equal(item('pages', false, 'insert-page-number').enabled, false);
});
