import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { EditorView } from 'prosemirror-view';
import { loadRenderer } from './load-renderer.mjs';
import { prepareEditorDom } from './dom-test-helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const mappingUrl = new URL('../../../src/renderer/editor/schema/mapping.ts', import.meta.url);
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);
const referenceUrl = new URL('../../../src/renderer/editor/format/reference.ts', import.meta.url);

function id(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function documentWith(content) {
  return {
    view: 'pageless',
    page: { paper: 'letter', orientation: 'portrait', margins: { top: 1, right: 1, bottom: 1, left: 1 } },
    header: { id: id(1), align: 'left', lineSpacing: 'single', spaceBefore: 0, spaceAfter: 0, indents: { left: 0, first: 0, hanging: 0 }, content: [] },
    footer: { id: id(2), align: 'left', lineSpacing: 'single', spaceBefore: 0, spaceAfter: 0, indents: { left: 0, first: 0, hanging: 0 }, content: [] },
    blocks: [{
      type: 'paragraph',
      id: id(3),
      align: 'left',
      lineSpacing: 'single',
      spaceBefore: 0,
      spaceAfter: 0,
      indents: { left: 0, first: 0, hanging: 0 },
      content,
    }],
  };
}

function ruleText(document) {
  const sheet = document.adoptedStyleSheets.at(-1);
  assert.ok(sheet);
  return [...sheet.cssRules].map((rule) => rule.cssText).join('\n');
}

test('a light highlight keeps its color and draws theme text dark', async () => {
  const { DEFAULT_HIGHLIGHT_COLOR } = await loadRenderer(referenceUrl);
  const { editorDocFromDocument } = await loadRenderer(mappingUrl);
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const { document, window } = parseHTML('<!doctype html><html><body></body></html>');
  const restore = prepareEditorDom(document, window);
  const host = document.createElement('div');
  document.body.append(host);
  const doc = editorDocFromDocument(documentWith([
    { type: 'text', text: 'Sun', marks: { highlight: DEFAULT_HIGHLIGHT_COLOR } },
    { type: 'text', text: ' ' },
    { type: 'text', text: 'Night', marks: { highlight: '#1B2838' } },
    { type: 'text', text: ' ' },
    { type: 'text', text: 'Ink', marks: { highlight: DEFAULT_HIGHLIGHT_COLOR, color: '#B3261E' } },
  ]));
  const view = new EditorView(host, {
    state: createTabEditorState(doc),
    attributes: { class: 'page-sheet', 'data-region': 'page-editor' },
  });
  try {
    const tokens = await readFile(path.join(root, 'src/renderer/styles/tokens.css'), 'utf8');
    assert.match(tokens, /--color-text-primary:\s*#1F2630/);
    const rules = ruleText(document);
    const yellow = DEFAULT_HIGHLIGHT_COLOR.toLowerCase();
    assert.match(rules, new RegExp(`\\[data-highlight="${yellow}"\\][^{]*\\{[^}]*background-color:\\s*${yellow}`));
    assert.match(rules, new RegExp(`\\[data-highlight="${yellow}"\\][^{]*\\{[^}]*color:\\s*#1f2630`));
    const darkRule = rules.match(/\[data-highlight="#1b2838"\][^{]*\{([^}]*)\}/);
    assert.ok(darkRule);
    assert.match(darkRule[1], /background-color:\s*#1b2838/);
    assert.equal(/(^|;)\s*color\s*:/.test(darkRule[1]), false);
    assert.match(rules, /\.page-sheet span\[data-text-color\] span\[data-highlight\]\s*\{[^}]*color:\s*inherit/);
    assert.match(rules, /\[data-text-color="#b3261e"\][^{]*\{[^}]*color:\s*#b3261e/);
    assert.equal(view.dom.querySelector('[style]'), null);
    assert.equal(view.dom.querySelector('style'), null);
    const highlighted = view.dom.querySelector(`span[data-highlight="${yellow}"]`);
    assert.equal(highlighted.getAttribute('style'), null);
  } finally {
    view.destroy();
    restore();
  }
});
