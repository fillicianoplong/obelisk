import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { NodeSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { parseHTML } from 'linkedom';
import { loadRenderer } from '../editor/load-renderer.mjs';
import { prepareEditorDom } from '../editor/dom-test-helpers.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const targetUrl = new URL('../../../src/renderer/shell/contextmenu/target.ts', import.meta.url);
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);
const commandsUrl = new URL('../../../src/renderer/editor/block-commands.ts', import.meta.url);
const idUrl = new URL('../../../src/renderer/editor/block-id.ts', import.meta.url);

test('proseBlockType maps top-level editor blocks', async () => {
  const state = await loadRenderer(stateUrl);
  const commands = await loadRenderer(commandsUrl);
  const { newBlockId } = await loadRenderer(idUrl);
  const { proseBlockType, resolveMenuKind } = await loadRenderer(targetUrl);
  let editorState = state.createTabEditorState();
  assert.equal(proseBlockType(editorState.doc.child(0)), 'paragraph');
  for (const row of [
    { kind: 'heading', blockType: 'heading', options: { level: 1 } },
    { kind: 'bulleted-list', blockType: 'bulleted-list' },
    { kind: 'quote', blockType: 'quote' },
    { kind: 'code', blockType: 'code' },
  ]) {
    editorState = state.createTabEditorState();
    editorState = editorState.apply(
      commands.insertTextBlock(editorState.tr, row.kind, newBlockId, { ...(row.options ?? {}), after: 0 }),
    );
    assert.equal(proseBlockType(editorState.doc.child(1)), row.blockType);
    assert.equal(resolveMenuKind(editorState, row.blockType, { closest() { return null; } }), 'text');
  }
});

test('paragraph uses the text menu unless a block is selected', async () => {
  const state = await loadRenderer(stateUrl);
  const { proseBlockType, resolveMenuKind } = await loadRenderer(targetUrl);
  const editorState = state.createTabEditorState();
  assert.equal(proseBlockType(editorState.doc.child(0)), 'paragraph');
  assert.equal(resolveMenuKind(editorState, 'paragraph', null), 'text');
  const selected = editorState.apply(editorState.tr.setSelection(NodeSelection.create(editorState.doc, 0)));
  assert.equal(resolveMenuKind(selected, 'paragraph', null, true), 'block');
});

test('resolveContextTarget below the last block targets that block', async () => {
  const state = await loadRenderer(stateUrl);
  const { resolveContextTarget } = await loadRenderer(targetUrl);
  const tokensCss = await readFile(path.join(root, 'src/renderer/styles/tokens.css'), 'utf8');
  const { document, window } = parseHTML('<!DOCTYPE html><html><head></head><body></body></html>');
  const restore = prepareEditorDom(document, window);
  const style = document.createElement('style');
  style.textContent = tokensCss;
  document.head.append(style);
  const host = document.createElement('div');
  document.body.append(host);
  const editorState = state.createTabEditorState();
  const view = new EditorView(host, {
    state: editorState,
    attributes: { class: 'page-sheet', 'data-region': 'page-editor' },
  });
  try {
    const rect = view.dom.getBoundingClientRect();
    const target = resolveContextTarget(
      view,
      rect.left + 24,
      rect.bottom + 48,
      view.dom,
      false,
    );
    assert.equal(target.kind, 'block');
    assert.equal(target.blockType, 'paragraph');
    assert.equal(target.blockIndex, 0);
  } finally {
    view.destroy();
    restore();
  }
});