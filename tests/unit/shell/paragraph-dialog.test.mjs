import assert from 'node:assert/strict';
import test from 'node:test';
import { loadRenderer } from '../editor/load-renderer.mjs';
import { checkDocument } from '../../../dist/shared/schema/index.js';

const mappingUrl = new URL('../../../src/renderer/editor/schema/mapping.ts', import.meta.url);
const paragraphUrl = new URL('../../../src/renderer/editor/paragraph-format-commands.ts', import.meta.url);
const modelUrl = new URL('../../../src/renderer/shell/tabs/model.ts', import.meta.url);
const documentUrl = new URL('../../../src/renderer/shell/tabs/document.ts', import.meta.url);
const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);
const mlaUrl = new URL('../../../src/templates/mla/document.ts', import.meta.url);
const paragraphDialogUrl = new URL('../../../src/renderer/shell/paragraph/model.ts', import.meta.url);

function blockId(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

test('document default line spacing applies to new blocks and survives save mapping', async () => {
  const { createBaseDocument, newBlockId } = await loadRenderer(documentUrl);
  const { editorDocFromDocument, documentFromEditorDoc } = await loadRenderer(mappingUrl);
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const { applyParagraphDialogCommand } = await loadRenderer(paragraphUrl);
  const { withDefaultLineSpacing } = await loadRenderer(modelUrl);

  const base = createBaseDocument(newBlockId);
  let tab = {
    editor: createTabEditorState(editorDocFromDocument(base.document)),
    baseDocument: base.document,
  };
  tab = withDefaultLineSpacing(tab, 'double');
  tab = {
    ...tab,
    editor: createTabEditorState(editorDocFromDocument(tab.baseDocument)),
  };

  assert.equal(tab.baseDocument.defaultLineSpacing, 'double');
  const first = tab.editor.doc.child(0);
  assert.equal(first.attrs.lineSpacing, null);

  const nextState = applyParagraphDialogCommand({
    scope: 'document',
    clearLineSpacingOverride: true,
    spaceBefore: 0,
    spaceAfter: 0,
  })(tab.editor, (tr) => {
    tab = { ...tab, editor: tab.editor.apply(tr) };
  });
  assert.equal(nextState, true);

  const built = documentFromEditorDoc(tab.baseDocument, tab.editor.doc, newBlockId);
  assert.equal(built.document.defaultLineSpacing, 'double');
  const savedParagraph = built.document.blocks.find((block) => block.type === 'paragraph');
  assert.ok(savedParagraph);
  assert.equal(Object.hasOwn(savedParagraph, 'lineSpacing'), false);

  const reopened = createTabEditorState(editorDocFromDocument(built.document));
  const after = applyParagraphDialogCommand({
    scope: 'document',
    clearLineSpacingOverride: true,
  })(reopened, () => {});
  assert.equal(after, true);
  assert.equal(reopened.doc.child(0).attrs.lineSpacing, null);

  const checked = checkDocument(built.document);
  assert.equal(checked.ok, true, checked.ok ? '' : JSON.stringify(checked));
});

test('MLA template sets document default double without per-block overrides', async () => {
  const { createMlaDocument } = await loadRenderer(mlaUrl);
  const { mlaDocumentMatchesReference } = await loadRenderer(
    new URL('../../../src/templates/mla/reference.ts', import.meta.url),
  );
  let n = 0;
  const built = createMlaDocument(() => blockId(++n));
  assert.equal(built.document.defaultLineSpacing, 'double');
  for (const block of built.document.blocks) {
    if (block.type !== 'paragraph') {
      continue;
    }
    assert.equal(Object.hasOwn(block, 'lineSpacing'), false);
  }
  assert.equal(mlaDocumentMatchesReference(built.document), true);
});

test('selected-block apply keeps a per-block override', async () => {
  const { createBaseDocument, newBlockId } = await loadRenderer(documentUrl);
  const { editorDocFromDocument } = await loadRenderer(mappingUrl);
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const { applyParagraphDialogCommand } = await loadRenderer(paragraphUrl);
  const { withDefaultLineSpacing } = await loadRenderer(modelUrl);
  const { TextSelection } = await import('prosemirror-state');

  const base = createBaseDocument(newBlockId);
  const doc = editorDocFromDocument({
    ...base.document,
    defaultLineSpacing: 'double',
    blocks: [
      base.document.blocks[0],
      { ...base.document.blocks[0], id: blockId(2), content: [{ type: 'text', text: 'Two' }] },
    ],
  });
  let state = createTabEditorState(doc);
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size)));

  const applied = applyParagraphDialogCommand({
    scope: 'selection',
    lineSpacing: '1.5',
    align: 'center',
    indentLeft: 0.5,
    indentFirst: 0,
    indentHanging: 0,
  })(state, (tr) => {
    state = state.apply(tr);
  });
  assert.equal(applied, true);
  assert.equal(state.doc.child(0).attrs.lineSpacing, '1.5');
  assert.equal(state.doc.child(1).attrs.lineSpacing, '1.5');
  assert.equal(state.doc.child(0).attrs.align, 'center');
  assert.equal(state.doc.child(0).attrs.indentLeft, 0.5);

  const tab = withDefaultLineSpacing({ baseDocument: { ...base.document, defaultLineSpacing: 'double' } }, 'double');
  assert.equal(tab.baseDocument.defaultLineSpacing, 'double');
});

test('paragraph dialog defaults Apply to Whole document with only a caret', async () => {
  const { createBaseDocument, newBlockId } = await loadRenderer(documentUrl);
  const { editorDocFromDocument } = await loadRenderer(mappingUrl);
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const { paragraphDialogInitial } = await loadRenderer(paragraphDialogUrl);
  const base = createBaseDocument(newBlockId);
  const state = createTabEditorState(editorDocFromDocument(base.document));
  const initial = paragraphDialogInitial(base.document, state);
  assert.equal(initial.scope, 'document');
  assert.equal(initial.align, 'left');
  assert.equal(initial.specialIndent, 'none');
});

test('paragraph dialog apply sets first-line indent on document scope', async () => {
  const { createBaseDocument, newBlockId } = await loadRenderer(documentUrl);
  const { editorDocFromDocument } = await loadRenderer(mappingUrl);
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const { applyParagraphDialogCommand } = await loadRenderer(paragraphUrl);
  const base = createBaseDocument(newBlockId);
  let state = createTabEditorState(editorDocFromDocument(base.document));
  const applied = applyParagraphDialogCommand({
    scope: 'document',
    lineSpacing: '1.5',
    clearLineSpacingOverride: true,
    indentFirst: 0.5,
    indentHanging: 0,
    spaceBefore: 0,
    spaceAfter: 0,
  })(state, (tr) => {
    state = state.apply(tr);
  });
  assert.equal(applied, true);
  assert.equal(state.doc.child(0).attrs.indentFirst, 0.5);
  assert.equal(state.doc.child(0).attrs.lineSpacing, null);
});

test('withDefaultParagraphFormat stores align indents and advanced line spacing', async () => {
  const { createBaseDocument, newBlockId } = await loadRenderer(documentUrl);
  const { withDefaultParagraphFormat } = await loadRenderer(modelUrl);
  const base = createBaseDocument(newBlockId);
  let tab = {
    id: 't1',
    title: 'Doc',
    editor: null,
    savedDoc: null,
    revision: 0,
    stat: null,
    savePhase: null,
    baseDocument: base.document,
    savedView: 'pages',
    savedPage: { paper: 'letter', orientation: 'portrait', margins: { top: 1, right: 1, bottom: 1, left: 1 } },
    savedHeader: {},
    savedFooter: {},
    blockIds: [],
  };
  tab = withDefaultParagraphFormat(tab, {
    align: 'justify',
    lineSpacing: 'multiple',
    lineSpacingAt: 1.35,
    spaceBefore: 6,
    spaceAfter: 12,
    indents: { left: 0.5, right: 0.25, first: 0, hanging: 0 },
    dontAddSpaceBetweenSameStyle: true,
  });
  assert.equal(tab.baseDocument.defaultParagraph?.align, 'justify');
  assert.equal(tab.baseDocument.defaultParagraph?.lineSpacing, 'multiple');
  assert.equal(tab.baseDocument.defaultParagraph?.lineSpacingAt, 1.35);
  assert.equal(tab.baseDocument.defaultParagraph?.dontAddSpaceBetweenSameStyle, true);
});

test('paragraph dialog apply persists right indent and collapse flag', async () => {
  const { createBaseDocument, newBlockId } = await loadRenderer(documentUrl);
  const { editorDocFromDocument, documentFromEditorDoc } = await loadRenderer(mappingUrl);
  const { createTabEditorState } = await loadRenderer(stateUrl);
  const { applyParagraphDialogCommand } = await loadRenderer(paragraphUrl);
  const base = createBaseDocument(newBlockId);
  let state = createTabEditorState(editorDocFromDocument(base.document));
  const applied = applyParagraphDialogCommand({
    scope: 'document',
    clearLineSpacingOverride: true,
    indentRight: 0.5,
    dontAddSpaceBetweenSameStyle: true,
    spaceBefore: 0,
    spaceAfter: 0,
  })(state, (tr) => {
    state = state.apply(tr);
  });
  assert.equal(applied, true);
  assert.equal(state.doc.child(0).attrs.indentRight, 0.5);
  assert.equal(state.doc.child(0).attrs.dontAddSpaceBetweenSameStyle, true);
  const built = documentFromEditorDoc(base.document, state.doc, newBlockId);
  const para = built.document.blocks.find((b) => b.type === 'paragraph');
  assert.equal(para.indents.right, 0.5);
  assert.equal(para.dontAddSpaceBetweenSameStyle, true);
});