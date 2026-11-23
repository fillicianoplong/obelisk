import assert from 'node:assert/strict';
import test from 'node:test';
import { TextSelection } from 'prosemirror-state';
import { loadRenderer } from './load-renderer.mjs';

const commandsUrl = new URL('../../../src/renderer/editor/link/commands.ts', import.meta.url);
const mappingUrl = new URL('../../../src/renderer/editor/schema/mapping.ts', import.meta.url);
const schemaUrl = new URL('../../../src/renderer/editor/schema.ts', import.meta.url);
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);
const menuUrl = new URL('../../../src/renderer/editor/menu-commands.ts', import.meta.url);
const shortcutsUrl = new URL('../../../src/renderer/shell/shortcuts.ts', import.meta.url);
const applyUrl = new URL('../../../src/renderer/shell/menus/apply.ts', import.meta.url);
const contextUrl = new URL('../../../src/renderer/shell/contextmenu/model.ts', import.meta.url);
const targetUrl = new URL('../../../src/renderer/shell/contextmenu/target.ts', import.meta.url);

const BLOCK = '00000000-0000-4000-8000-000000000003';

function id(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function paragraphFields() {
  return {
    align: 'left',
    lineSpacing: 'single',
    spaceBefore: 0,
    spaceAfter: 0,
    indents: { left: 0, first: 0, hanging: 0 },
  };
}

function documentWith(content) {
  return {
    view: 'pageless',
    page: {
      paper: 'letter',
      orientation: 'portrait',
      margins: { top: 1, right: 1, bottom: 1, left: 1 },
    },
    header: { id: id(1), ...paragraphFields(), content: [] },
    footer: { id: id(2), ...paragraphFields(), content: [] },
    blocks: [{
      type: 'paragraph',
      id: BLOCK,
      ...paragraphFields(),
      content,
    }],
  };
}

function applyCommand(state, command) {
  let next = null;
  const ok = command(state, (tr) => {
    next = state.apply(tr);
  });
  return ok && next !== null ? next : null;
}

test('Ctrl+K maps to the link command', async () => {
  const { linkShellShortcut } = await loadRenderer(shortcutsUrl);
  const key = { altKey: false, ctrlKey: true, metaKey: false, shiftKey: false, repeat: false };
  assert.equal(linkShellShortcut({ ...key, key: 'k' }), 'insert-link');
  assert.equal(linkShellShortcut({ ...key, key: 'K' }), 'insert-link');
  assert.equal(linkShellShortcut({ ...key, key: 'k', shiftKey: true }), null);
});

test('a link mark round-trips and does not expose an href', async () => {
  const { editorSchema } = await loadRenderer(schemaUrl);
  const { editorDocFromDocument, documentFromEditorDoc } = await loadRenderer(mappingUrl);
  const base = documentWith([{ type: 'link', address: 'https://example.com/docs', text: 'Notes' }]);
  const doc = editorDocFromDocument(base);
  const text = doc.firstChild.firstChild;
  assert.equal(text.text, 'Notes');
  assert.equal(text.marks[0].type.name, 'link');
  assert.equal(text.marks[0].attrs.address, 'https://example.com/docs');
  const built = documentFromEditorDoc(base, doc, () => id(9));
  assert.equal(
    JSON.stringify(built.document.blocks[0].content),
    JSON.stringify(base.blocks[0].content),
  );

  const dom = editorSchema.marks.link.spec.toDOM(text.marks[0]);
  assert.equal(dom[0], 'a');
  assert.equal(dom[1].class, 'editor-link');
  assert.equal(dom[1]['data-link'], 'true');
  assert.equal(dom[1]['data-href'], 'https://example.com/docs');
  assert.equal(Object.hasOwn(dom[1], 'href'), false);

  const refused = editorSchema.marks.link.spec.toDOM(
    editorSchema.marks.link.create({ address: 'javascript:alert(1)' }),
  );
  assert.equal(refused[0], 'span');
  assert.equal(Object.hasOwn(refused[1], 'href'), false);
});

test('file, javascript, and network-path links are not marks when loaded', async () => {
  const { editorDocFromDocument } = await loadRenderer(mappingUrl);
  for (const address of ['javascript:alert(1)', 'file:///C:/Windows', '\\\\server\\share', '//server/share']) {
    const doc = editorDocFromDocument(documentWith([{ type: 'link', address, text: 'Bad' }]));
    const text = doc.firstChild.firstChild;
    assert.equal(text.text, 'Bad', address);
    assert.equal(text.marks.length, 0, address);
  }
});

test('the link dialog command stores an allowed address and refuses the others', async () => {
  const { applyLinkCommand, linkAround, removeLinkCommand } = await loadRenderer(commandsUrl);
  const { createTabEditorState, insertText } = await loadRenderer(stateUrl);
  let state = createTabEditorState();
  state = insertText(state, 'Hello');
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
  const linked = applyCommand(state, applyLinkCommand('Hello', 'https://example.com/docs'));
  assert.ok(linked);
  const mark = linked.doc.firstChild.firstChild.marks[0];
  assert.equal(mark.type.name, 'link');
  assert.equal(mark.attrs.address, 'https://example.com/docs');
  const inside = linked.apply(linked.tr.setSelection(TextSelection.create(linked.doc, 3)));
  assert.equal(linkAround(inside).address, 'https://example.com/docs');
  assert.equal(linkAround(inside).text, 'Hello');

  for (const address of ['javascript:alert(1)', 'file:///C:/Windows', '\\\\server\\share']) {
    assert.equal(applyCommand(state, applyLinkCommand('Hello', address)), null, address);
  }

  const cleared = applyCommand(inside, removeLinkCommand());
  assert.ok(cleared);
  assert.equal(cleared.doc.textContent, 'Hello');
  assert.equal(cleared.doc.firstChild.firstChild.marks.length, 0);
});

test('Insert Link and Open link follow the selection', async () => {
  const { editorMenuCommand } = await loadRenderer(menuUrl);
  const { createTabEditorState, insertText } = await loadRenderer(stateUrl);
  const { applyLinkCommand } = await loadRenderer(commandsUrl);
  const { liveMenus, liveMenuEntries } = await loadRenderer(applyUrl);
  const { composeContextMenu } = await loadRenderer(contextUrl);
  const { resolveMenuKind } = await loadRenderer(targetUrl);
  let state = createTabEditorState();
  state = insertText(state, 'Hello');
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)));
  assert.equal(editorMenuCommand('insert-link')(state), true);
  const menus = liveMenus({
    documentTab: true,
    selectionEmpty: false,
    editorState: state,
  });
  const insert = menus.find((menu) => menu.id === 'insert');
  const linkItem = insert.entries.find((entry) => entry.id === 'insert-link');
  assert.equal(linkItem.enabled, true);

  const linked = applyCommand(state, applyLinkCommand('Hello', 'https://example.com/docs'));
  const inside = linked.apply(linked.tr.setSelection(TextSelection.create(linked.doc, 3)));
  assert.equal(resolveMenuKind(inside, 'paragraph', null, true), 'link');
  const entries = liveMenuEntries(composeContextMenu('link'), {
    documentTab: true,
    selectionEmpty: true,
    editorState: inside,
  });
  const open = entries.find((entry) => entry.id === 'link-open');
  assert.equal(open.label, 'Open link');
  assert.equal(open.enabled, true);
  assert.equal(open.command, 'link-open');

  const plain = createTabEditorState();
  const plainEntries = liveMenuEntries(composeContextMenu('link'), {
    documentTab: true,
    selectionEmpty: true,
    editorState: plain,
  });
  assert.equal(plainEntries.find((entry) => entry.id === 'link-open').enabled, false);
  assert.equal(resolveMenuKind(plain, 'paragraph', null, true), 'text');
});
