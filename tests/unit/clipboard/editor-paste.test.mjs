import assert from 'node:assert/strict';
import test from 'node:test';
import { TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { parseHTML } from 'linkedom';
import { loadRenderer } from '../editor/load-renderer.mjs';
import { prepareEditorDom } from '../editor/dom-test-helpers.mjs';

const stateUrl = new URL('../../../src/renderer/editor/state.ts', import.meta.url);
const mappingUrl = new URL('../../../src/renderer/editor/schema/mapping.ts', import.meta.url);
const menuUrl = new URL('../../../src/renderer/editor/menu-commands.ts', import.meta.url);
const applyUrl = new URL('../../../src/renderer/shell/menus/apply.ts', import.meta.url);
const contextMenuUrl = new URL('../../../src/renderer/shell/contextmenu/model.ts', import.meta.url);
const gutterUrl = new URL('../../../src/renderer/editor/block-gutter.ts', import.meta.url);

function id(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function paragraph(text) {
  return {
    type: 'paragraph',
    id: id(3),
    align: 'left',
    lineSpacing: 'single',
    spaceBefore: 0,
    spaceAfter: 0,
    indents: { left: 0, first: 0, hanging: 0 },
    content: text ? [{ type: 'text', text }] : [],
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

function pasteEvent(view, { html = '', text = '', shiftKey = false } = {}) {
  const event = new view.dom.ownerDocument.defaultView.Event('paste', { bubbles: true, cancelable: true });
  event.shiftKey = shiftKey;
  event.clipboardData = {
    getData(type) {
      if (type === 'text/html') {
        return html;
      }
      if (type === 'text/plain' || type === 'Text') {
        return text;
      }
      return '';
    },
    items: [],
  };
  return event;
}

async function flush() {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function marksNamed(view, text) {
  const found = [];
  view.state.doc.descendants((node) => {
    if (node.isText && node.text === text) {
      found.push(...node.marks.map((mark) => mark.type.name));
    }
  });
  return found;
}

test('Ctrl+V keeps allowed formatting and drops a script', async () => {
  const { view, restore } = await editorView([paragraph('')]);
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    const event = pasteEvent(view, {
      html: '<p>Hello <strong>there</strong><script>alert(1)</script></p><p><a href="javascript:alert(1)">Click</a></p>',
      text: 'Hello there',
    });
    view.dom.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    await flush();
    assert.equal(view.state.doc.textContent.includes('alert'), false);
    assert.equal(view.state.doc.textContent.includes('javascript:'), false);
    assert.equal(view.state.doc.textContent.includes('Hello there'), true);
    assert.equal(view.state.doc.textContent.includes('Click'), true);
    assert.deepEqual(marksNamed(view, 'there'), ['bold']);
    assert.equal(view.state.doc.child(1).type.name, 'paragraph');
  } finally {
    view.destroy();
    restore();
  }
});

test('Ctrl+V keeps safe pasted links as links and unsafe ones as words', async () => {
  const { view, restore } = await editorView([paragraph('')]);
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    view.dom.dispatchEvent(pasteEvent(view, {
      html: '<p><a href="https://example.com/docs">docs</a> <a href="mailto:student@school.edu">mail</a> '
        + '<a href="javascript:alert(1)">bad</a> <a href="file:///C:/secret.txt">secret</a></p>',
      text: 'docs mail bad secret',
    }));
    await flush();
    const links = {};
    view.state.doc.descendants((node) => {
      if (node.isText) {
        const link = node.marks.find((mark) => mark.type.name === 'link');
        links[node.text] = link ? link.attrs.address : null;
      }
    });
    assert.equal(links.docs, 'https://example.com/docs');
    assert.equal(links.mail, 'mailto:student@school.edu');
    assert.equal(view.state.doc.textContent.includes('bad'), true);
    assert.equal(view.state.doc.textContent.includes('secret'), true);
    assert.equal(Object.values(links).some((address) => address && /javascript:|file:/i.test(address)), false);
  } finally {
    view.destroy();
    restore();
  }
});

test('Ctrl+Shift+V and Paste as plain text keep lines without marks', async () => {
  const { editorMenuCommand } = await loadRenderer(menuUrl);
  const { view, restore } = await editorView([paragraph('Start')]);
  try {
    const end = view.state.doc.content.size - 1;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)));
    view.dom.dispatchEvent(pasteEvent(view, {
      html: '<p><b>Bold</b></p>',
      text: 'Plain line',
      shiftKey: true,
    }));
    await flush();
    assert.equal(view.state.doc.textContent.includes('Plain line'), true);
    assert.equal(view.state.doc.textContent.includes('Bold'), false);
    assert.equal(marksNamed(view, 'Plain line').length, 0);

    const restoreClipboard = installClipboard({
      html: '<p><b>Hidden</b></p>',
      text: 'Menu plain',
    });
    const ran = editorMenuCommand('edit-paste-plain')(view.state, view.dispatch, view);
    assert.equal(ran, true);
    await flush();
    await flush();
    assert.equal(view.state.doc.textContent.includes('Menu plain'), true);
    assert.equal(view.state.doc.textContent.includes('Hidden'), false);
    restoreClipboard();
  } finally {
    view.destroy();
    restore();
  }
});

test('Paste from the menu is enabled and uses the sanitizer', async () => {
  const { editorMenuCommand, editorMenuCommandEnabled } = await loadRenderer(menuUrl);
  const { liveMenus } = await loadRenderer(applyUrl);
  const { view, restore } = await editorView([paragraph('')]);
  try {
    assert.equal(editorMenuCommandEnabled(view.state, 'edit-paste'), true);
    assert.equal(editorMenuCommandEnabled(view.state, 'edit-paste-plain'), true);
    const menus = liveMenus({
      documentTab: true,
      selectionEmpty: true,
      editorState: view.state,
    });
    const edit = menus.find((menu) => menu.id === 'edit');
    assert.equal(edit.entries.find((entry) => entry.id === 'edit-paste').enabled, true);
    assert.equal(edit.entries.find((entry) => entry.id === 'edit-paste-plain').enabled, true);

    const restoreClipboard = installClipboard({
      html: '<h2>Title</h2><table><tr><td>A</td><td><b>B</b></td></tr></table><img src="https://evil.example/a.png">',
      text: 'Title',
    });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    editorMenuCommand('edit-paste')(view.state, view.dispatch, view);
    await flush();
    await flush();
    assert.equal(view.state.doc.child(0).type.name, 'heading');
    assert.equal(view.state.doc.textContent.includes('Title'), true);
    assert.equal(view.state.doc.textContent.includes('A'), true);
    assert.equal(view.state.doc.textContent.includes('B'), true);
    assert.equal(view.state.doc.textContent.includes('evil.example'), false);
    assert.deepEqual(marksNamed(view, 'B'), ['bold']);
    restoreClipboard();
  } finally {
    view.destroy();
    restore();
  }
});

const CODE = 'function add(a, b) {\n\treturn a + b;\n\n    // four spaces\n}';

function codeBlock(text) {
  return { type: 'code', id: id(4), text };
}

function paragraphTexts(view) {
  const texts = [];
  view.state.doc.forEach((node) => {
    texts.push([node.type.name, node.textContent]);
  });
  return texts;
}

test('Ctrl+V of code from an editor into a paragraph keeps each line and its tabs', async () => {
  const { view, restore } = await editorView([paragraph('')]);
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    view.dom.dispatchEvent(pasteEvent(view, {
      html: '<div style="white-space: pre;"><div><span>function add(a, b) {</span></div>'
        + '<div><span>\t</span><span>return a + b;</span></div><br>'
        + '<div><span>    // four spaces</span></div><div><span>}</span></div></div>',
      text: CODE,
    }));
    await flush();
    assert.deepEqual(paragraphTexts(view), [
      ['paragraph', 'function add(a, b) {'],
      ['paragraph', '\treturn a + b;'],
      ['paragraph', ''],
      ['paragraph', '    // four spaces'],
      ['paragraph', '}'],
    ]);
  } finally {
    view.destroy();
    restore();
  }
});

test('Ctrl+V of plain multi-line code into a paragraph keeps each line and its tabs', async () => {
  const { view, restore } = await editorView([paragraph('')]);
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    view.dom.dispatchEvent(pasteEvent(view, { text: `${CODE}\r\n` }));
    await flush();
    assert.deepEqual(paragraphTexts(view).map(([, text]) => text), CODE.split('\n'));
  } finally {
    view.destroy();
    restore();
  }
});

test('Ctrl+V into a code block keeps the newlines and tabs exactly', async () => {
  const { view, restore } = await editorView([codeBlock('')]);
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    view.dom.dispatchEvent(pasteEvent(view, {
      html: '<div style="white-space: pre;"><div><span>ignored markup</span></div></div>',
      text: CODE,
    }));
    await flush();
    assert.equal(view.state.doc.childCount, 1);
    assert.equal(view.state.doc.child(0).type.name, 'code_block');
    assert.equal(view.state.doc.child(0).textContent, CODE);
  } finally {
    view.destroy();
    restore();
  }
});

function menuItem(entries, id) {
  return entries.find((entry) => entry.id === id);
}

function installClipboard({ html, text }) {
  const host = globalThis;
  const previous = host.window;
  host.window = {
    obelisk: {
      'clipboard:read': () => Promise.resolve({ status: 'ok', html, text, image: null }),
    },
  };
  return () => {
    if (previous === undefined) {
      delete host.window;
    } else {
      host.window = previous;
    }
  };
}

test('Cut and Copy follow the selection and call copy and cut', async () => {
  const { editorMenuCommand, editorMenuCommandEnabled } = await loadRenderer(menuUrl);
  const { liveMenus, liveMenuEntries } = await loadRenderer(applyUrl);
  const { composeContextMenu } = await loadRenderer(contextMenuUrl);
  const { applyBlockMenuAction, blockMenuActionEnabled } = await loadRenderer(gutterUrl);
  const { view, restore } = await editorView([paragraph('Selected words')]);
  try {
    const emptyContext = {
      documentTab: true,
      selectionEmpty: true,
      editorState: view.state,
    };
    const emptyEdit = liveMenus(emptyContext).find((menu) => menu.id === 'edit');
    assert.equal(menuItem(emptyEdit.entries, 'edit-cut').enabled, false);
    assert.equal(menuItem(emptyEdit.entries, 'edit-copy').enabled, false);
    const emptyMenu = liveMenuEntries(composeContextMenu('text'), emptyContext);
    assert.equal(menuItem(emptyMenu, 'edit-cut').enabled, false);
    assert.equal(menuItem(emptyMenu, 'edit-copy').enabled, false);
    assert.equal(editorMenuCommandEnabled(view.state, 'edit-cut'), false);
    assert.equal(editorMenuCommandEnabled(view.state, 'edit-copy'), false);
    assert.equal(blockMenuActionEnabled(view.state, 0, 'edit-cut'), true);
    assert.equal(blockMenuActionEnabled(view.state, 0, 'edit-copy'), true);

    const end = 1 + view.state.doc.textContent.length;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, end)));
    const selectedContext = {
      documentTab: true,
      selectionEmpty: false,
      editorState: view.state,
    };
    const edit = liveMenus(selectedContext).find((menu) => menu.id === 'edit');
    assert.equal(menuItem(edit.entries, 'edit-cut').enabled, true);
    assert.equal(menuItem(edit.entries, 'edit-copy').enabled, true);
    const context = liveMenuEntries(composeContextMenu('text'), selectedContext);
    assert.equal(menuItem(context, 'edit-cut').enabled, true);
    assert.equal(menuItem(context, 'edit-copy').enabled, true);
    assert.equal(editorMenuCommandEnabled(view.state, 'edit-cut'), true);
    assert.equal(editorMenuCommandEnabled(view.state, 'edit-copy'), true);

    const commands = [];
    view.focus = () => {};
    view.dom.ownerDocument.execCommand = (command) => {
      commands.push(command);
      return true;
    };
    assert.equal(editorMenuCommand('edit-copy')(view.state, view.dispatch, view), true);
    assert.equal(editorMenuCommand('edit-cut')(view.state, view.dispatch, view), true);
    assert.equal(applyBlockMenuAction(view.state, 0, 'edit-copy', view.dispatch, view), true);
    assert.equal(applyBlockMenuAction(view.state, 0, 'edit-cut', view.dispatch, view), true);
    assert.deepEqual(commands, ['copy', 'cut', 'copy', 'cut']);
  } finally {
    view.destroy();
    restore();
  }
});

test('Cut and Copy use the editor selection when the menu snapshot is stale', async () => {
  const { withLiveEditor } = await loadRenderer(new URL('../../../src/renderer/shell/menus/live-editor.ts', import.meta.url));
  const { liveMenus } = await loadRenderer(applyUrl);
  const { pointerInsideTextSelection } = await loadRenderer(
    new URL('../../../src/renderer/shell/contextmenu/editor-plugin.ts', import.meta.url),
  );
  const { view, restore } = await editorView([paragraph('Selected words')]);
  const previousDocument = globalThis.document;
  globalThis.document = view.dom.ownerDocument;
  view.dom.editorView = view;
  try {
    const end = 1 + view.state.doc.textContent.length;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, end)));
    const live = withLiveEditor({
      documentTab: true,
      selectionEmpty: true,
      editorState: null,
      spelling: true,
    });
    assert.equal(live.selectionEmpty, false);
    const edit = liveMenus(live).find((menu) => menu.id === 'edit');
    assert.equal(menuItem(edit.entries, 'edit-cut').enabled, true);
    assert.equal(menuItem(edit.entries, 'edit-copy').enabled, true);

    view.posAtCoords = () => ({ pos: 4, inside: -1 });
    view.dom.ownerDocument.getSelection = () => ({
      rangeCount: 0,
      isCollapsed: true,
      getRangeAt: () => ({ getClientRects: () => [] }),
    });
    assert.equal(pointerInsideTextSelection(view, { clientX: 12, clientY: 12 }), true);
    view.posAtCoords = () => ({ pos: end + 5, inside: -1 });
    assert.equal(pointerInsideTextSelection(view, { clientX: 1, clientY: 1 }), false);
  } finally {
    if (previousDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = previousDocument;
    }
    view.destroy();
    restore();
  }
});
