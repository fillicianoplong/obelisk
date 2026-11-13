import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseHTML } from 'linkedom';
import { EditorView } from 'prosemirror-view';
import {
  ALIGNMENTS,
  LINE_SPACINGS,
  SPACE_BEFORE_AFTER_PT,
} from '../../../dist/shared/schema/index.js';
import { loadRenderer } from './load-renderer.mjs';
import { prepareEditorDom } from './dom-test-helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);
const mappingUrl = new URL('../../../src/renderer/editor/schema/mapping.ts', import.meta.url);
const schemaUrl = new URL('../../../src/renderer/editor/schema/index.ts', import.meta.url);

function id(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function paragraphBlock(format) {
  return {
    type: 'paragraph',
    id: id(3),
    align: 'left',
    lineSpacing: 'single',
    spaceBefore: 0,
    spaceAfter: 0,
    indents: { left: 0, first: 0, hanging: 0 },
    content: [{
      type: 'text',
      text: 'Rich',
      marks: {
        bold: true,
        italic: true,
        underline: true,
        font: 'Liberation Sans',
        size: 14,
        color: '#112233',
        highlight: '#445566',
      },
    }, {
      type: 'text',
      text: ' ',
    }, {
      type: 'text',
      text: 'X',
      marks: { strike: true, code: true },
    }, {
      type: 'text',
      text: '2',
      marks: { superscript: true },
    }],
    ...format,
  };
}

function assertNoInlineStyleAttributes(rootEl) {
  const styled = rootEl.querySelectorAll('[style]');
  assert.deepEqual(
    [...styled].map((element) => element.outerHTML.slice(0, 120)),
    [],
    'the editor DOM must not use inline style attributes under the app CSP',
  );
}

function assertNoStyleElements(rootEl) {
  const tags = rootEl.querySelectorAll('style');
  assert.deepEqual(
    [...tags].map((element) => element.outerHTML.slice(0, 120)),
    [],
    'the editor DOM must not contain style elements under the app CSP',
  );
}

test('the editor DOM uses no inline style attributes with full paragraph and character formatting', async () => {
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const { editorDocFromDocument } = await loadRenderer(mappingUrl);
  const { editorSchema } = await loadRenderer(schemaUrl);

  const css = await readFile(path.join(root, 'src/renderer/editor/editor.css'), 'utf8');
  const cspCss = await readFile(path.join(root, 'src/renderer/editor/format/csp-format.css'), 'utf8');
  const pmCss = await readFile(path.join(root, 'node_modules/prosemirror-view/style/prosemirror.css'), 'utf8');

  const { document, window } = parseHTML('<!DOCTYPE html><html><body></body></html>');
  const restoreDomGlobals = prepareEditorDom(document, window);

  const style = document.createElement('style');
  style.textContent = `${pmCss}\n${css}\n${cspCss}`;
  document.head.append(style);

  const blocks = [];
  for (const align of ALIGNMENTS) {
    for (const lineSpacing of LINE_SPACINGS) {
      for (const spaceBefore of SPACE_BEFORE_AFTER_PT) {
        for (const spaceAfter of SPACE_BEFORE_AFTER_PT) {
          blocks.push(paragraphBlock({
            align,
            lineSpacing,
            spaceBefore,
            spaceAfter,
            indents: { left: 0.5, first: 0.25, hanging: 0 },
          }));
        }
      }
    }
  }
  blocks.push(paragraphBlock({
    indents: { left: 0, first: 0, hanging: 0.5 },
  }));

  const base = {
    view: 'pageless',
    page: { paper: 'letter', orientation: 'portrait', margins: { top: 1, right: 1, bottom: 1, left: 1 } },
    header: { id: id(1), align: 'left', lineSpacing: 'single', spaceBefore: 0, spaceAfter: 0, indents: { left: 0, first: 0, hanging: 0 }, content: [] },
    footer: { id: id(2), align: 'left', lineSpacing: 'single', spaceBefore: 0, spaceAfter: 0, indents: { left: 0, first: 0, hanging: 0 }, content: [] },
    blocks,
  };

  const doc = editorDocFromDocument(base);
  doc.check();
  assert.equal(doc.type.schema, editorSchema);

  const host = document.createElement('div');
  document.body.append(host);

  const state = createTabEditorState(doc);
  const view = new EditorView(host, {
    state,
    attributes: { class: 'page-sheet', 'data-region': 'page-editor' },
  });

  try {
    assertNoInlineStyleAttributes(view.dom);
    assertNoStyleElements(host);
    for (const element of view.dom.querySelectorAll('*')) {
      assert.equal(element.hasAttribute('style'), false, element.outerHTML.slice(0, 120));
    }
    const colored = view.dom.querySelector('span[data-text-color]');
    const highlighted = view.dom.querySelector('span[data-highlight]');
    assert.ok(colored);
    assert.ok(highlighted);
    assert.equal(colored.getAttribute('data-text-color'), '#112233');
    assert.equal(highlighted.getAttribute('data-highlight'), '#445566');
    const sheet = document.adoptedStyleSheets.at(-1);
    assert.ok(sheet);
    const rules = sheet.cssRules.map((rule) => rule.cssText).join('\n');
    assert.match(rules, /\[data-text-color="#112233"\]/);
    assert.match(rules, /\[data-highlight="#445566"\]/);
  } finally {
    view.destroy();
    restoreDomGlobals();
  }
});
