import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRenderer } from '../editor/load-renderer.mjs';

const modelUrl = new URL('../../../src/renderer/shell/menus/model.ts', import.meta.url);
const referenceUrl = new URL('../../../src/renderer/shell/menus/reference.ts', import.meta.url);

test('each top menu lists the Menus reference items in order', async () => {
  const { APP_MENUS } = await loadRenderer(modelUrl);
  const { MENU_REFERENCE_BY_MENU, menuItemLabelsForReference } = await loadRenderer(referenceUrl);

  for (const menu of APP_MENUS) {
    const expected = MENU_REFERENCE_BY_MENU[menu.label];
    assert.ok(expected, menu.label);
    const actual = menuItemLabelsForReference(menu);
    assert.deepEqual(actual, [...expected], menu.label);
  }
});

test('Insert follows the slash menu groups with Date and time and Link', async () => {
  const { APP_MENUS, itemLabel, isSeparator } = await loadRenderer(modelUrl);
  const insert = APP_MENUS.find((menu) => menu.id === 'insert');
  const items = insert.entries.filter((entry) => !isSeparator(entry)).map((entry) => itemLabel(entry));
  assert.ok(items.includes('Date and time…'));
  assert.ok(items.includes('Columns'));
  assert.ok(items.includes('Diagram'));
  assert.ok(items.includes('Link…'));
  const linkIndex = items.indexOf('Link…');
  const dateIndex = items.indexOf('Date and time…');
  assert.ok(dateIndex >= 0 && linkIndex > dateIndex, 'Link… follows Date and time…');
});