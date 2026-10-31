import assert from 'node:assert/strict';
import test from 'node:test';
import { TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { parseHTML } from 'linkedom';
import { INDENT_STEP_IN } from '../../../dist/shared/schema/index.js';
import { loadRenderer } from './load-renderer.mjs';
import { dispatchEditorKeyDown, prepareEditorDom } from './dom-test-helpers.mjs';

const mappingUrl = new URL('../../../src/renderer/editor/schema/mapping.ts', import.meta.url);
const formatUrl = new URL('../../../src/renderer/editor/format-commands.ts', import.meta.url);
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);

function id(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function paragraph(content, format = {}) {
  return {
    type: 'paragraph',
    id: id(3),
    align: 'left',
    lineSpacing: 'single',
    spaceBefore: 0,
    spaceAfter: 0,
    indents: { left: 0, first: 0, hanging: 0 },
    content,
    ...format,
  };
}

function baseDocument(blocks) {
  return {
    view: 'pageless',
    page: { paper: 'letter', orientation: 'portrait', margins: { top: 1, right: 1, bottom: 1, left: 1 } },
    header: { id: id(1), align: 'left', lineSpacing: 'single', spaceBefore: 0, spaceAfter: 0, indents: { left: 0, first: 0, hanging: 0 }, content: [] },
    footer: { id: id(2), align: 'left', lineSpacing: 'single', spaceBefore: 0, spaceAfter: 0, indents: { left: 0, first: 0, hanging: 0 }, content: [] },
    blocks,
  };
}

async function editorViewFromDocument(base) {
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const { editorDocFromDocument } = await loadRenderer(mappingUrl);
  const { document, window } = parseHTML('<!DOCTYPE html><html><body></body></html>');
  const restore = prepareEditorDom(document, window);
  const host = document.createElement('div');
  document.body.append(host);
  const state = createTabEditorState(editorDocFromDocument(base));
  const view = new EditorView(host, {
    state,
    attributes: { class: 'page-sheet', 'data-region': 'page-editor' },
  });
  return { view, restore };
}

test('Tab at the start of a paragraph sets first-line indent; elsewhere it steps left indent', async () => {
  const { view, restore } = await editorViewFromDocument(baseDocument([
    paragraph([{ type: 'text', text: 'Hello world' }]),
  ]));
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 1)));
    dispatchEditorKeyDown(view, 'Tab');
    assert.equal(view.state.doc.child(0).attrs.indentFirst, INDENT_STEP_IN * 2);
    assert.equal(view.state.doc.child(0).attrs.indentLeft, 0);

    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3, 3)));
    dispatchEditorKeyDown(view, 'Tab');
    assert.equal(view.state.doc.child(0).attrs.indentLeft, INDENT_STEP_IN);
  } finally {
    view.destroy();
    restore();
  }
});

test('Shift+Tab at the start of a paragraph clears first-line indent', async () => {
  const { view, restore } = await editorViewFromDocument(baseDocument([
    paragraph([{ type: 'text', text: 'Hello' }], { indents: { left: 0, first: 0.5, hanging: 0 } }),
  ]));
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 1)));
    dispatchEditorKeyDown(view, 'Tab', { shiftKey: true });
    assert.equal(view.state.doc.child(0).attrs.indentFirst, 0);
  } finally {
    view.destroy();
    restore();
  }
});

test('Enter through the editor keymap keeps paragraph format and stored marks', async () => {
  const { applyCharacterMarksCommand } = await loadRenderer(formatUrl);
  const { view, restore } = await editorViewFromDocument(baseDocument([
    paragraph([{ type: 'text', text: 'Line one' }], {
      align: 'center',
      lineSpacing: 'double',
      spaceBefore: 6,
      spaceAfter: 12,
      indents: { left: 0.5, first: 0, hanging: 0 },
    }),
  ]));
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 9)));
    applyCharacterMarksCommand({ bold: true, size: 14 })(view.state, view.dispatch.bind(view));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3, 3)));
    dispatchEditorKeyDown(view, 'Enter');
    assert.equal(view.state.doc.childCount, 2);
    const second = view.state.doc.child(1);
    assert.equal(second.attrs.align, 'center');
    assert.equal(second.attrs.lineSpacing, 'double');
    assert.equal(second.attrs.spaceBefore, 6);
    assert.equal(second.attrs.spaceAfter, 12);
    assert.equal(second.attrs.indentLeft, 0.5);
    assert.ok(view.state.schema.marks.bold.isInSet(view.state.storedMarks ?? []));
  } finally {
    view.destroy();
    restore();
  }
});
