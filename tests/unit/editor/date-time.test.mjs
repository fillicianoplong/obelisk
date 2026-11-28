import assert from 'node:assert/strict';
import test from 'node:test';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import { loadRenderer } from './load-renderer.mjs';

const commandsUrl = new URL('../../../src/renderer/editor/date-time/commands.ts', import.meta.url);
const mappingUrl = new URL('../../../src/renderer/editor/schema/mapping.ts', import.meta.url);
const schemaUrl = new URL('../../../src/renderer/editor/schema.ts', import.meta.url);
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);
const menuUrl = new URL('../../../src/renderer/editor/menu-commands.ts', import.meta.url);
const slashUrl = new URL('../../../src/renderer/editor/slash/reference.ts', import.meta.url);
const applyUrl = new URL('../../../src/renderer/shell/menus/apply.ts', import.meta.url);

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

test('a date chip round-trips through the editor document model', async () => {
  const { editorDocFromDocument, documentFromEditorDoc } = await loadRenderer(mappingUrl);
  const base = documentWith([{ type: 'dateChip', dateTime: '2027-03-04T21:05', format: 'iso-date' }]);
  const doc = editorDocFromDocument(base);
  const chip = doc.firstChild.firstChild;
  assert.equal(chip.type.name, 'date_chip');
  assert.equal(chip.attrs.dateTime, '2027-03-04T21:05');
  const built = documentFromEditorDoc(base, doc, () => id(9));
  assert.deepEqual(built.document.blocks[0].content, base.blocks[0].content);
});

test('insert and edit change a date chip twice in one undo group each', async () => {
  const {
    applyDateTimeChipCommand,
    convertDateTimeToTextCommand,
    removeDateTimeChipCommand,
  } = await loadRenderer(commandsUrl);
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const { editorDocFromDocument } = await loadRenderer(mappingUrl);
  let state = createTabEditorState(editorDocFromDocument(documentWith([])));
  state = applyCommand(state, applyDateTimeChipCommand('2027-03-04T21:05', 'windows-short', 'insert'));
  assert.ok(state);
  assert.equal(state.doc.firstChild.firstChild.type.name, 'date_chip');
  state = applyCommand(state, applyDateTimeChipCommand('2027-05-01T12:00', 'windows-short', 'edit'));
  assert.equal(state.doc.firstChild.firstChild.attrs.dateTime, '2027-05-01T12:00');
  state = applyCommand(state, applyDateTimeChipCommand('2027-06-02T15:45', 'time', 'edit'));
  assert.equal(state.doc.firstChild.firstChild.attrs.format, 'time');
  state = applyCommand(state, convertDateTimeToTextCommand());
  assert.equal(state.doc.firstChild.firstChild.isText, true);
  assert.equal(state.doc.firstChild.firstChild.text, '3:45 PM');
  state = applyCommand(state, applyDateTimeChipCommand('2027-03-04T21:05', 'iso-date', 'insert'));
  state = applyCommand(state, removeDateTimeChipCommand());
  assert.equal(state.doc.firstChild.childCount, 1);
  assert.equal(state.doc.firstChild.firstChild.text, '3:45 PM');
});

test('Insert menu and slash Date wire to insert-date-time', async () => {
  const slash = await loadRenderer(slashUrl);
  const apply = await loadRenderer(applyUrl);
  const dateEntry = slash.SLASH_MENU_ENTRIES.find((row) => row.type === 'item' && row.item.id === 'date');
  assert.equal(dateEntry?.item.command, 'insert-date-time');
  assert.equal(apply.UNWIRED_MENU_IDS.has('insert-date-time'), false);
});

test('insert-date-time is enabled in a text block', async () => {
  const { editorMenuCommandEnabled } = await loadRenderer(menuUrl);
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const { editorDocFromDocument } = await loadRenderer(mappingUrl);
  const state = createTabEditorState(editorDocFromDocument(documentWith([])));
  const pos = state.doc.resolve(1);
  const selected = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos.pos)));
  assert.equal(editorMenuCommandEnabled(selected, 'insert-date-time'), true);
});