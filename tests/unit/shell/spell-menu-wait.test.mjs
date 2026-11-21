import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mock, test } from 'node:test';
import { parseHTML } from 'linkedom';
import { loadRenderer } from '../editor/load-renderer.mjs';

const pluginUrl = new URL('../../../src/renderer/shell/contextmenu/editor-plugin.ts', import.meta.url);
const modeUrl = new URL('../../../src/renderer/editor/spellcheck-mode.ts', import.meta.url);
const detail = { tabId: 'tab-1' };

test('the text menu waits for the spell context before it opens', async () => {
  const saved = { document: globalThis.document, window: globalThis.window, HTMLElement: globalThis.HTMLElement };
  const parsed = parseHTML('<!doctype html><html><body><div class="page-sheet" spellcheck="true"></div></body></html>');
  const { document, window } = parsed;
  globalThis.document = document;
  globalThis.window = window;
  globalThis.HTMLElement = window.HTMLElement;
  const buckets = new Map();
  void window.addEventListener;
  void window.dispatchEvent;
  window.addEventListener = (type, fn) => {
    const list = buckets.get(type) ?? [];
    list.push(fn);
    buckets.set(type, list);
  };
  window.dispatchEvent = (event) => {
    for (const fn of buckets.get(event.type) ?? []) {
      fn(event);
    }
    return true;
  };
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  let listener = null;
  window.obelisk = {
    'spell:context': {
      subscribe(fn) {
        listener = fn;
        return 1;
      },
      unsubscribe() {},
    },
  };
  const opened = [];
  window.addEventListener('obelisk:context-menu-request', (event) => {
    opened.push(event.detail);
  });
  try {
    const { publishContextMenu } = await loadRenderer(pluginUrl);
    const { setSpellcheckEnabled } = await loadRenderer(modeUrl);
    setSpellcheckEnabled(true);

    const timedOut = publishContextMenu(Date.now(), detail);
    await Promise.resolve();
    assert.equal(opened.length, 0);
    mock.timers.tick(299);
    await Promise.resolve();
    assert.equal(opened.length, 0);
    mock.timers.tick(1);
    await timedOut;
    assert.equal(opened.length, 1);
    assert.equal(opened[0].spelling, null);

    mock.timers.tick(1000);
    opened.length = 0;
    const arrived = publishContextMenu(Date.now(), detail);
    await Promise.resolve();
    assert.equal(opened.length, 0);
    listener({ misspelledWord: '', suggestions: [] });
    await Promise.resolve();
    assert.equal(opened.length, 0);
    listener({
      misspelledWord: 'hllo',
      suggestions: ['hello', 'hollo', 'hallo', 'hullo', 'halo', 'extra'],
    });
    await arrived;
    assert.equal(opened.length, 1);
    assert.equal(opened[0].spelling.word, 'hllo');
    assert.deepEqual(opened[0].spelling.suggestions, ['hello', 'hollo', 'hallo', 'hullo', 'halo']);

    setSpellcheckEnabled(false);
    const sheet = document.querySelector('.page-sheet');
    assert.equal(sheet.getAttribute('spellcheck'), 'true');
    assert.equal(sheet.hasAttribute('data-spell-hidden'), true);
    mock.timers.tick(1000);
    opened.length = 0;
    const hidden = publishContextMenu(Date.now(), detail);
    listener({ misspelledWord: 'hllo', suggestions: ['hello'] });
    await hidden;
    assert.equal(opened[0].spelling, null);
    setSpellcheckEnabled(true);
    assert.equal(sheet.hasAttribute('data-spell-hidden'), false);
  } finally {
    mock.timers.reset();
    globalThis.document = saved.document;
    globalThis.window = saved.window;
    globalThis.HTMLElement = saved.HTMLElement;
  }
});

test('hiding spell check clears the spelling underline', async () => {
  const css = await readFile(new URL('../../../src/renderer/editor/editor.css', import.meta.url), 'utf8');
  assert.match(css, /\.page-sheet\[data-spell-hidden\] ::spelling-error \{[^}]*text-decoration-line:\s*none/);
});
