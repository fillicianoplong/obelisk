import assert from 'node:assert/strict';
import test from 'node:test';
import { TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { parseHTML } from 'linkedom';
import { loadRenderer } from '../editor/load-renderer.mjs';
import { prepareEditorDom } from '../editor/dom-test-helpers.mjs';
const OBELISK_BLOCKS_MIME = 'application/x-obelisk-blocks+json';

const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);
const mappingUrl = new URL('../../../src/renderer/editor/schema/mapping.ts', import.meta.url);
const blockIdUrl = new URL('../../../src/renderer/editor/block-id.ts', import.meta.url);
const blockHandleUrl = new URL('../../../src/renderer/editor/block-handle-plugin.ts', import.meta.url);
const blockMoveUrl = new URL('../../../src/renderer/editor/block-move-commands.ts', import.meta.url);
const clipboardUrl = new URL('../../../src/renderer/clipboard/index.ts', import.meta.url);

function id(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function paragraph(text, blockId = id(3)) {
  return {
    type: 'paragraph',
    id: blockId,
    align: 'left',
    lineSpacing: 'single',
    spaceBefore: 0,
    spaceAfter: 0,
    indents: { left: 0, first: 0, hanging: 0 },
    content: text ? [{ type: 'text', text }] : [],
  };
}

function tableBlock(blockId = id(5)) {
  return {
    type: 'table',
    id: blockId,
    headerRow: true,
    columnWidths: [2, 2, 2],
    rows: [
      { cells: [{ kind: 'text', content: [{ type: 'text', text: 'A' }] }, { kind: 'text', content: [{ type: 'text', text: 'B' }] }] },
      { cells: [{ kind: 'text', content: [{ type: 'text', text: '1' }] }, { kind: 'text', content: [{ type: 'text', text: '2' }] }] },
    ],
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

async function editorView(blocks) {
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const { editorDocFromDocument } = await loadRenderer(mappingUrl);
  const { document, window } = parseHTML('<!DOCTYPE html><html><body></body></html>');
  const restore = prepareEditorDom(document, window);
  const host = document.createElement('div');
  document.body.append(host);
  const state = createTabEditorState(editorDocFromDocument(baseDocument(blocks)));
  const view = new EditorView(host, {
    state,
    attributes: { class: 'page-sheet', 'data-region': 'page-editor' },
  });
  return { view, restore };
}

function clipboardStore() {
  const store = new Map();
  return {
    data: {
      clearData() {
        store.clear();
      },
      setData(type, value) {
        store.set(type, value);
      },
      getData(type) {
        return store.get(type) ?? '';
      },
      items: [],
    },
    store,
  };
}

function copyEvent(view, store) {
  const event = new view.dom.ownerDocument.defaultView.Event('copy', { bubbles: true, cancelable: true });
  event.clipboardData = store.data;
  return event;
}

function pasteEvent(view, store, { plain = false } = {}) {
  const event = new view.dom.ownerDocument.defaultView.Event('paste', { bubbles: true, cancelable: true });
  event.shiftKey = plain;
  event.clipboardData = store.data;
  return event;
}

async function flush() {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

test('AC-15: copy a table between tabs gets new IDs and keeps the grid', async () => {
  const { blockHandlePluginKey } = await loadRenderer(blockHandleUrl);
  const { finishBlockRangeTransaction } = await loadRenderer(blockMoveUrl);
  const { isBlockId } = await loadRenderer(blockIdUrl);
  const { view: source, restore: restoreSource } = await editorView([paragraph('Before', id(10)), tableBlock(id(11))]);
  const { view: target, restore: restoreTarget } = await editorView([paragraph('')]);
  try {
  const sourceTableId = id(11);
  let tr = source.state.tr;
  tr = finishBlockRangeTransaction(tr, 1, 1);
  tr = tr.setMeta(blockHandlePluginKey, {
    anchor: 1,
    from: 1,
    to: 1,
    drag: null,
    hoverBlock: null,
    hoverPinned: false,
  });
  source.dispatch(tr);
  const { store } = clipboardStore();
  const copied = copyEvent(source, store);
  source.dom.dispatchEvent(copied);
  assert.equal(copied.defaultPrevented, true);
  assert.ok(store.has(OBELISK_BLOCKS_MIME));
  assert.match(store.get('text/html'), /<table>/);
  assert.equal(store.get('text/plain').includes('\t'), true);

  target.dispatch(target.state.tr.setSelection(TextSelection.create(target.state.doc, 1)));
  target.dom.dispatchEvent(pasteEvent(target, store));
  await flush();

  const tableNode = target.state.doc.child(1);
  assert.equal(tableNode.type.name, 'structured_block');
  assert.equal(tableNode.attrs.blockType, 'table');
  assert.notEqual(tableNode.attrs.blockId, sourceTableId);
  assert.equal(isBlockId(tableNode.attrs.blockId), true);
  } finally {
    source.destroy();
    target.destroy();
    restoreSource();
    restoreTarget();
  }
});

test('AC-15: cut removes blocks and leaves them on the clipboard', async () => {
  const { blockHandlePluginKey } = await loadRenderer(blockHandleUrl);
  const { finishBlockRangeTransaction } = await loadRenderer(blockMoveUrl);
  const { view, restore } = await editorView([paragraph('Keep', id(20)), paragraph('Gone', id(21))]);
  try {
    let tr = finishBlockRangeTransaction(view.state.tr, 1, 1);
    tr = tr.setMeta(blockHandlePluginKey, {
      anchor: 1,
      from: 1,
      to: 1,
      drag: null,
      hoverBlock: null,
      hoverPinned: false,
    });
    view.dispatch(tr);
    const { data, store } = clipboardStore();
    const event = new view.dom.ownerDocument.defaultView.Event('cut', { bubbles: true, cancelable: true });
    event.clipboardData = data;
    view.dom.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.ok(store.has('text/plain'));
    assert.equal(view.state.doc.childCount, 1);
    assert.equal(view.state.doc.textContent, 'Keep');
  } finally {
    view.destroy();
    restore();
  }
});

test('rich HTML and plain text flavors are written for copied blocks', async () => {
  const {
    blocksRichHtml,
    blocksPlainText,
    serializeObeliskClipboard,
    parseObeliskClipboard,
    remintObeliskBlocks,
  } = await loadRenderer(clipboardUrl);
  const { blocksJsonFromRange } = await loadRenderer(mappingUrl);
  const { newBlockId } = await loadRenderer(blockIdUrl);
  const { view, restore } = await editorView([paragraph('Hello'), tableBlock()]);
  try {
    const blocks = blocksJsonFromRange(view.state.doc, 0, 1);
    const html = blocksRichHtml(blocks);
    const text = blocksPlainText(blocks);
    assert.match(html, /<p>Hello<\/p>/);
    assert.match(html, /<table>/);
    assert.match(html, /<th>/);
    assert.equal(text.includes('Hello'), true);
    assert.equal(text.includes('\t'), true);
    const payload = serializeObeliskClipboard(blocks);
    const roundTrip = parseObeliskClipboard(payload);
    assert.ok(roundTrip);
    const reminted = remintObeliskBlocks(roundTrip, newBlockId);
    assert.notEqual(reminted[0].id, blocks[0].id);
    assert.notEqual(reminted[1].id, blocks[1].id);
  } finally {
    view.destroy();
    restore();
  }
});