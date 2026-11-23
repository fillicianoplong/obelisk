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

    view.dom.ownerDocument.execCommand = (command) => {
      if (command !== 'paste') {
        return false;
      }
      view.dom.dispatchEvent(pasteEvent(view, {
        html: '<p><b>Hidden</b></p>',
        text: 'Menu plain',
      }));
      return true;
    };
    const ran = editorMenuCommand('edit-paste-plain')(view.state, view.dispatch, view);
    assert.equal(ran, true);
    await flush();
    assert.equal(view.state.doc.textContent.includes('Menu plain'), true);
    assert.equal(view.state.doc.textContent.includes('Hidden'), false);
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

    view.dom.ownerDocument.execCommand = (command) => {
      if (command !== 'paste') {
        return false;
      }
      view.dom.dispatchEvent(pasteEvent(view, {
        html: '<h2>Title</h2><table><tr><td>A</td><td><b>B</b></td></tr></table><img src="https://evil.example/a.png">',
        text: 'Title',
      }));
      return true;
    };
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    editorMenuCommand('edit-paste')(view.state, view.dispatch, view);
    await flush();
    assert.equal(view.state.doc.child(0).type.name, 'heading');
    assert.equal(view.state.doc.textContent.includes('Title'), true);
    assert.equal(view.state.doc.textContent.includes('A'), true);
    assert.equal(view.state.doc.textContent.includes('B'), true);
    assert.equal(view.state.doc.textContent.includes('evil.example'), false);
    assert.deepEqual(marksNamed(view, 'B'), ['bold']);
  } finally {
    view.destroy();
    restore();
  }
});
