import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { parseHTML } from 'linkedom';
import { loadRenderer } from './load-renderer.mjs';
import {
  dispatchEditorKeyDown,
  dispatchEditorTextInput,
  prepareEditorDom,
  runEditorKeyDown,
} from './dom-test-helpers.mjs';
import { undoDepth, undo } from 'prosemirror-history';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);
const mappingUrl = new URL('../../../src/renderer/editor/schema/mapping.ts', import.meta.url);
const slashUrl = new URL('../../../src/renderer/editor/slash/slash-menu-plugin.ts', import.meta.url);
const inputRulesUrl = new URL('../../../src/renderer/editor/keymap/input-rules.ts', import.meta.url);
const blockHandleUrl = new URL('../../../src/renderer/editor/block-handle-plugin.ts', import.meta.url);
const formatUrl = new URL('../../../src/renderer/editor/format/reference.ts', import.meta.url);

function id(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function paragraph(content = [], extra = {}) {
  return {
    type: 'paragraph',
    id: id(3),
    align: 'left',
    lineSpacing: 'single',
    spaceBefore: 0,
    spaceAfter: 0,
    indents: { left: 0, first: 0, hanging: 0 },
    content,
    ...extra,
  };
}

function codeBlock(text = '') {
  return {
    type: 'code',
    id: id(4),
    text,
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

async function editorViewFromBlocks(blocks) {
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const { editorDocFromDocument } = await loadRenderer(mappingUrl);
  const tokensCss = await readFile(path.join(root, 'src/renderer/styles/tokens.css'), 'utf8');
  const editorCss = await readFile(path.join(root, 'src/renderer/editor/editor.css'), 'utf8');
  const { document, window } = parseHTML('<!DOCTYPE html><html><head></head><body></body></html>');
  const restore = prepareEditorDom(document, window);
  const style = document.createElement('style');
  style.textContent = `${tokensCss}\n${editorCss}`;
  document.head.append(style);
  const host = document.createElement('div');
  document.body.append(host);
  const state = createTabEditorState(editorDocFromDocument(baseDocument(blocks)));
  const view = new EditorView(host, {
    state,
    attributes: { class: 'page-sheet', 'data-region': 'page-editor' },
  });
  return { view, restore };
}

function caretAtStart(view) {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
}

function typeText(view, text) {
  for (const ch of text) {
    dispatchEditorTextInput(view, ch);
  }
}

function undoInputRule(view) {
  dispatchEditorKeyDown(view, 'z', { ctrlKey: true });
}

function topBlock(view) {
  return view.state.doc.child(0);
}

function visibleText(view, block = topBlock(view)) {
  return block.textContent.replaceAll('\u200b', '');
}

const BLOCK_SHORTCUTS = [
  ['# ', 'heading', { level: 1 }],
  ['## ', 'heading', { level: 2 }],
  ['### ', 'heading', { level: 3 }],
  ['#### ', 'heading', { level: 4 }],
  ['##### ', 'heading', { level: 5 }],
  ['###### ', 'heading', { level: 6 }],
  ['- ', 'bullet_list', {}],
  ['* ', 'bullet_list', {}],
  ['1. ', 'ordered_list', {}],
  ['[ ] ', 'checklist', {}],
  ['> ', 'blockquote', {}],
  ['```', 'code_block', {}],
  ['---', 'horizontal_rule', {}],
];

for (const [typed, typeName, attrs] of BLOCK_SHORTCUTS) {
  test(`typed shortcut ${JSON.stringify(typed)} becomes ${typeName}`, async () => {
    const { view, restore } = await editorViewFromBlocks([paragraph()]);
    try {
      caretAtStart(view);
      typeText(view, typed);
      const block = topBlock(view);
      assert.equal(block.type.name, typeName);
      for (const [key, value] of Object.entries(attrs)) {
        assert.equal(block.attrs[key], value);
      }
    } finally {
      view.destroy();
      restore();
    }
  });
}

test('Ctrl+Z after a block shortcut restores the typed characters', async () => {
  const { view, restore } = await editorViewFromBlocks([paragraph()]);
  try {
    caretAtStart(view);
    typeText(view, '## ');
    assert.equal(topBlock(view).type.name, 'heading');
    undoInputRule(view);
    assert.equal(topBlock(view).type.name, 'paragraph');
    assert.equal(topBlock(view).textContent, '## ');
  } finally {
    view.destroy();
    restore();
  }
});

const INLINE_SHORTCUTS = [
  ['**bold**', 'bold', 'bold'],
  ['*italic*', 'italic', 'italic'],
  ['~~strike~~', 'strike', 'strike'],
  ['`code`', 'code', 'code'],
];

for (const [typed, markName, inner] of INLINE_SHORTCUTS) {
  test(`typed shortcut ${JSON.stringify(typed)} becomes ${markName}`, async () => {
    const { view, restore } = await editorViewFromBlocks([paragraph()]);
    try {
      caretAtStart(view);
      typeText(view, typed);
      const block = topBlock(view);
      assert.equal(visibleText(view, block), inner);
      const mark = block.firstChild?.marks.find((item) => item.type.name === markName);
      assert.ok(mark, `missing ${markName} mark`);
    } finally {
      view.destroy();
      restore();
    }
  });
}

test('Ctrl+Z after an inline shortcut restores the typed characters', async () => {
  const { view, restore } = await editorViewFromBlocks([paragraph()]);
  try {
    caretAtStart(view);
    typeText(view, '*word*');
    assert.equal(visibleText(view), 'word');
    undoInputRule(view);
    assert.equal(visibleText(view), '*word*');
  } finally {
    view.destroy();
    restore();
  }
});

test('underscores stay as typed for italic', async () => {
  const { view, restore } = await editorViewFromBlocks([paragraph()]);
  try {
    caretAtStart(view);
    typeText(view, '_plain_');
    assert.equal(topBlock(view).textContent, '_plain_');
    assert.equal(topBlock(view).firstChild?.marks.length ?? 0, 0);
  } finally {
    view.destroy();
    restore();
  }
});

test('equation shortcuts stay unbound', async () => {
  const { view, restore } = await editorViewFromBlocks([paragraph()]);
  try {
    caretAtStart(view);
    typeText(view, '$$');
    assert.equal(topBlock(view).type.name, 'paragraph');
    assert.equal(topBlock(view).textContent, '$$');
  } finally {
    view.destroy();
    restore();
  }
});

test('block shortcuts do not fire inside a code block', async () => {
  const { view, restore } = await editorViewFromBlocks([codeBlock()]);
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    typeText(view, '# ');
    assert.equal(topBlock(view).type.name, 'code_block');
    assert.equal(topBlock(view).textContent, '# ');
  } finally {
    view.destroy();
    restore();
  }
});

test('input rules do not run while the slash menu is open', async () => {
  const { slashMenuState } = await loadRenderer(slashUrl);
  const { view, restore } = await editorViewFromBlocks([paragraph()]);
  try {
    caretAtStart(view);
    dispatchEditorTextInput(view, '/');
    assert.equal(slashMenuState(view.state).open, true);
    dispatchEditorTextInput(view, '-');
    assert.equal(topBlock(view).type.name, 'paragraph');
    assert.equal(topBlock(view).textContent, '/-');
  } finally {
    view.destroy();
    restore();
  }
});

test('keyboard reference lists unbound shortcuts and keys', async () => {
  const { TYPED_SHORTCUTS_UNBOUND, EDITOR_KEYS_UNBOUND } = await loadRenderer(inputRulesUrl);
  assert.deepEqual([...TYPED_SHORTCUTS_UNBOUND], [
    '$$ → equation block',
    '$...$ → inline equation',
  ]);
  assert.deepEqual([...EDITOR_KEYS_UNBOUND], [
    'Ctrl+K → Link',
    'Ctrl+Shift+V → Paste as plain text',
  ]);
});

test('the hover block handle updates its kind after a heading shortcut', async () => {
  const { setBlockHandleHover } = await loadRenderer(blockHandleUrl);
  const { view, restore } = await editorViewFromBlocks([paragraph()]);
  try {
    caretAtStart(view);
    typeText(view, '## ');
    assert.equal(topBlock(view).type.name, 'heading');
    setBlockHandleHover(view, 0);
    const handleRoot = view.dom.closest('.page-region') ?? view.dom.parentElement ?? view.dom;
    const handle = handleRoot.querySelector('.block-handle-layer .block-handle[data-hover-active="true"]');
    assert.ok(handle instanceof view.dom.ownerDocument.defaultView.HTMLElement);
    assert.equal(handle.getAttribute('data-block-kind'), 'heading');
    assert.equal(handle.getAttribute('data-block-index'), '0');
    assert.ok(handle.getAttribute('data-block-id'));
    const handles = [...handleRoot.querySelectorAll('.block-handle-layer .block-handle')].filter((h) => !h.hidden);
    assert.equal(handles.length, 1);
  } finally {
    view.destroy();
    restore();
  }
});

test('a new list shortcut does not join the list below', async () => {
  const { view, restore } = await editorViewFromBlocks([
    paragraph(),
    {
      type: 'list',
      id: id(4),
      style: 'bulleted',
      items: [{ level: 0, content: [{ type: 'text', text: 'Existing' }] }],
    },
  ]);
  try {
    caretAtStart(view);
    typeText(view, '- ');
    assert.equal(view.state.doc.childCount, 2);
    assert.equal(view.state.doc.child(0).type.name, 'bullet_list');
    assert.equal(view.state.doc.child(1).type.name, 'bullet_list');
    assert.equal(view.state.selection.$from.index(0), 0);
    assert.equal(view.state.doc.child(0).textContent, '');
    assert.equal(view.state.doc.child(1).textContent, 'Existing');
  } finally {
    view.destroy();
    restore();
  }
});

test('Enter on an empty list item exits to a paragraph', async () => {
  const { view, restore } = await editorViewFromBlocks([
    {
      type: 'list',
      id: id(5),
      style: 'bulleted',
      items: [
        { level: 0, content: [{ type: 'text', text: 'Filled' }] },
        { level: 0, content: [] },
      ],
    },
  ]);
  try {
    const list = view.state.doc.child(0);
    const secondItemPos = 1 + list.child(0).nodeSize + 1;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, secondItemPos)));
    dispatchEditorKeyDown(view, 'Enter');
    assert.equal(view.state.doc.childCount, 2);
    assert.equal(view.state.doc.child(0).type.name, 'bullet_list');
    assert.equal(view.state.doc.child(0).childCount, 1);
    assert.equal(view.state.doc.child(1).type.name, 'paragraph');
  } finally {
    view.destroy();
    restore();
  }
});

test('mark shortcuts do not leave stored marks on the next typed character', async () => {
  const { view, restore } = await editorViewFromBlocks([paragraph()]);
  try {
    caretAtStart(view);
    typeText(view, '**a**');
    typeText(view, 'b');
    const block = topBlock(view);
    assert.equal(block.child(0)?.text, 'a');
    assert.ok(block.child(0)?.marks.some((mark) => mark.type.name === 'bold'));
    const last = block.child(block.childCount - 1);
    assert.ok(last?.isText);
    assert.equal(last.text?.replace('\u200b', ''), 'b');
    assert.equal(last.marks.length, 0);
  } finally {
    view.destroy();
    restore();
  }
});

test('undo steps land at word boundaries', async () => {
  const { view, restore } = await editorViewFromBlocks([paragraph()]);
  try {
    caretAtStart(view);
    typeText(view, 'one two');
    assert.equal(topBlock(view).textContent, 'one two');
    assert.ok(undoDepth(view.state) >= 2);
    undo(view.state, view.dispatch.bind(view));
    assert.equal(topBlock(view).textContent, 'one ');
    undo(view.state, view.dispatch.bind(view));
    assert.equal(topBlock(view).textContent, '');
  } finally {
    view.destroy();
    restore();
  }
});

test('Shift+Enter inserts a soft line break in a paragraph', async () => {
  const { view, restore } = await editorViewFromBlocks([paragraph()]);
  try {
    caretAtStart(view);
    dispatchEditorTextInput(view, 'Line');
    runEditorKeyDown(view, 'Enter', { shiftKey: true });
    dispatchEditorTextInput(view, 'two');
    const block = topBlock(view);
    assert.equal(block.childCount, 3);
    assert.equal(block.child(1).type.name, 'hard_break');
    assert.equal(block.child(0).text, 'Line');
    assert.equal(block.child(2).text, 'two');
  } finally {
    view.destroy();
    restore();
  }
});

test('Editor keyboard keys run without a mouse', async () => {
  const { FONT_SIZE_PT, DEFAULT_FONT_SIZE } = await loadRenderer(formatUrl);
  const { selectedBlockRange } = await loadRenderer(blockHandleUrl);
  const { view, restore } = await editorViewFromBlocks([
    paragraph([{ type: 'text', text: 'Format me' }]),
    paragraph([{ type: 'text', text: 'Two' }]),
  ]);
  try {
    const block = topBlock(view);
    const from = 1;
    const to = 1 + block.content.size;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
    dispatchEditorKeyDown(view, 'b', { ctrlKey: true });
    assert.ok(topBlock(view).firstChild?.marks.some((mark) => mark.type.name === 'bold'));

    dispatchEditorKeyDown(view, 'i', { ctrlKey: true });
    dispatchEditorKeyDown(view, 'u', { ctrlKey: true });
    dispatchEditorKeyDown(view, 'x', { ctrlKey: true, shiftKey: true });
    const marks = topBlock(view).firstChild?.marks.map((mark) => mark.type.name).sort();
    assert.deepEqual(marks, ['bold', 'italic', 'strike', 'underline']);

    dispatchEditorKeyDown(view, ' ', { ctrlKey: true });
    assert.equal(topBlock(view).firstChild?.marks.length ?? 0, 0);

    dispatchEditorKeyDown(view, 'l', { ctrlKey: true });
    assert.equal(topBlock(view).attrs.align, 'left');
    dispatchEditorKeyDown(view, 'e', { ctrlKey: true });
    assert.equal(topBlock(view).attrs.align, 'center');

    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
    dispatchEditorKeyDown(view, '>', { ctrlKey: true, shiftKey: true });
    const sizeMark = topBlock(view).firstChild?.marks.find((mark) => mark.type.name === 'fontSize');
    assert.ok(sizeMark);
    assert.ok(sizeMark.attrs.pt > DEFAULT_FONT_SIZE);
    assert.ok(FONT_SIZE_PT.includes(sizeMark.attrs.pt));

    dispatchEditorKeyDown(view, 'Enter', { ctrlKey: true });
    assert.equal(view.state.doc.childCount, 3);
    assert.equal(view.state.doc.child(1).type.name, 'page_break');

    caretAtStart(view);
    dispatchEditorKeyDown(view, 'Tab');
    assert.equal(topBlock(view).attrs.indentFirst, 0.5);

    dispatchEditorKeyDown(view, 'Escape');
    assert.deepEqual(selectedBlockRange(view.state), { from: 0, to: 0 });
  } finally {
    view.destroy();
    restore();
  }
});
