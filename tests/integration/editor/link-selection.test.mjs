import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  bindLaunchedApp,
  debuggerTargets,
  electronBinary,
  evaluate,
  focusPage,
  freePort,
  launchWithSandboxFallback,
  openCdp,
  sleep,
  STEP_TIMEOUT_MS,
  waitFor,
} from '../electron-launch.mjs';

const READY = `(() => {
  const editor = document.querySelector('[data-region="page-editor"]');
  if (!editor || editor.getAttribute('contenteditable') !== 'true') {
    return null;
  }
  if (document.documentElement.dataset.shellCommands !== 'ready') return null;
  if (document.querySelector('[data-page="start"]') && !document.querySelector('[data-region="page-editor"]')) {
    document.querySelector('.start-action-primary')?.click();
  }
  return document.querySelector('[data-region="page-editor"]') ? true : null;
})()`;

const TARGET = 'https://www.blender.org/download/';

/** Three plain lines; "Install" on the first line is bold. */
const SETUP = `(() => {
  const editor = document.querySelector('[data-region="page-editor"]');
  editor.focus();
  editor.editorCommands.replaceText('Install notes\\nDownload it and run it.\\nThen pick a theme.');
  const view = editor.editorView;
  view.dispatch(view.state.tr.addMark(1, 8, view.state.schema.marks.bold.create()));
  return true;
})()`;

const STATE = `(() => {
  const editor = document.querySelector('[data-region="page-editor"]');
  const view = editor.editorView;
  const lines = [];
  view.state.doc.forEach((block) => lines.push(block.textContent));
  const links = [];
  view.state.doc.descendants((node, pos) => {
    if (node.isText) {
      const link = node.marks.find((mark) => mark.type.name === 'link');
      if (link) {
        const last = links.at(-1);
        if (last && last.to === pos && last.address === link.attrs.address) {
          last.to = pos + node.nodeSize;
          last.text += node.text;
        } else {
          links.push({ from: pos, to: pos + node.nodeSize, text: node.text, address: link.attrs.address });
        }
      }
    }
  });
  const bold = [];
  view.state.doc.descendants((node) => {
    if (node.isText && node.marks.some((mark) => mark.type.name === 'bold')) {
      bold.push(node.text);
    }
  });
  const dialog = document.querySelector('.link-dialog');
  return {
    lines,
    links,
    bold: bold.join('|'),
    selection: { from: view.state.selection.from, to: view.state.selection.to },
    dialog: dialog ? {
      mode: dialog.getAttribute('data-link-dialog'),
      text: dialog.querySelector('[data-link-text]').value,
      address: dialog.querySelector('[data-link-address]').value,
    } : null,
    menu: [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent),
    contextOpen: document.querySelector('[data-region="context-menu"]') !== null,
  };
})()`;

async function launchApp(t) {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-link-selection-'));
  const session = { child: undefined, client: undefined, userDataDir };
  bindLaunchedApp(t, session);
  const port = await freePort();
  const openPage = async () => {
    const page = (await debuggerTargets(port)).find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
    assert.ok(page, 'the page has no DevTools socket');
    if (!session.client || session.client.url !== page.webSocketDebuggerUrl) {
      session.client?.close();
      session.client = openCdp(page.webSocketDebuggerUrl);
    }
    return session.client;
  };
  session.child = await launchWithSandboxFallback({
    binary: electronBinary(),
    args: ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`],
    ready(running) {
      return waitFor(
        running,
        async () => {
          const pages = (await debuggerTargets(port)).filter((target) => target.type === 'page');
          if (pages.length !== 1 || pages[0].title !== 'Obelisk') {
            return null;
          }
          return evaluate(await openPage(), READY);
        },
        20_000,
      );
    },
  });
  const client = await openPage();
  await evaluate(client, SETUP);
  await evaluate(client, `document.fonts.ready.then(() => true)`);
  await focusPage(client);
  await sleep(150);
  return { client };
}

function buttonFlag(button) {
  if (button === 'left') {
    return 1;
  }
  if (button === 'right') {
    return 2;
  }
  if (button === 'middle') {
    return 4;
  }
  return 0;
}

function mouse(client, type, point, button = 'none', modifiers = 0, clickCount) {
  const flag = buttonFlag(button);
  const held = type === 'mousePressed' || (type === 'mouseMoved' && flag !== 0);
  const count = clickCount ?? (type === 'mousePressed' || type === 'mouseReleased' ? 1 : 0);
  return client.send('Input.dispatchMouseEvent', {
    type,
    x: point.x,
    y: point.y,
    button: type === 'mouseMoved' && flag === 0 ? 'none' : button,
    buttons: held ? flag : 0,
    modifiers,
    clickCount: count,
  });
}

async function click(client, point, { button = 'left', modifiers = 0 } = {}) {
  await mouse(client, 'mouseMoved', point, 'none', modifiers);
  await mouse(client, 'mousePressed', point, button, modifiers);
  await mouse(client, 'mouseReleased', point, button, modifiers);
  await sleep(150);
}

async function key(client, name, code, virtualKey, modifiers = 0) {
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, windowsVirtualKeyCode: virtualKey, modifiers });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: virtualKey, modifiers });
  await sleep(120);
}

function centerOf(client, selector) {
  return evaluate(client, `(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) {
      return null;
    }
    const rect = node.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
}


async function waitState(client, predicate, label) {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    last = await evaluate(client, STATE);
    if (predicate(last)) {
      return last;
    }
    await sleep(30);
  }
  throw new Error(`${label}: ${JSON.stringify(last)}`);
}

/** Screen points for a character offset inside the given line. */
function pointAt(client, line, offset) {
  return evaluate(client, `(() => {
    const block = document.querySelectorAll('[data-region="page-editor"] > p')[${line}];
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let left = ${offset};
    let node = walker.nextNode();
    while (node && left > node.length) {
      left -= node.length;
      node = walker.nextNode();
    }
    const range = document.createRange();
    range.setStart(node, left);
    range.setEnd(node, left);
    const rect = range.getBoundingClientRect();
    const edge = block.getBoundingClientRect().left;
    let x = rect.left;
    const y = rect.top + Math.max(rect.height, block.getBoundingClientRect().height, 1) / 2;
    // The grip ends on the line's left edge. A rounded point there is a text
    // click, but the contextmenu event is aimed at the grip, which selects the
    // block. Paste then inserts a paragraph under that block. Step into the line.
    if (x <= edge + 0.5) {
      x = edge + 2;
    }
    return { x: Math.round(x), y: Math.round(y) };
  })()`);
}

async function dragSelect(client, line, from, to) {
  await focusPage(client);
  const a = await pointAt(client, line, from);
  const b = await pointAt(client, line, to);
  await mouse(client, 'mouseMoved', a);
  await mouse(client, 'mousePressed', a, 'left');
  await mouse(client, 'mouseMoved', b, 'left');
  await mouse(client, 'mouseReleased', b, 'left');
  await sleep(200);
  return { a, b };
}

async function selectionLength(client, length, label) {
  const deadline = Date.now() + 1_500;
  let last = null;
  while (Date.now() < deadline) {
    last = await evaluate(client, STATE);
    if (last.selection.to - last.selection.from === length) {
      return last;
    }
    await sleep(30);
  }
  throw new Error(`${label}: ${JSON.stringify(last)}`);
}

async function dragUntilSelected(client, line, from, to, length, label) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const points = await dragSelect(client, line, from, to);
      await selectionLength(client, length, label);
      return points;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function placeTextCaret(client, line, offset) {
  let last = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await focusPage(client);
    const caret = await pointAt(client, line, offset);
    await click(client, caret);
    const deadline = Date.now() + 1_000;
    while (Date.now() < deadline) {
      last = await evaluate(client, STATE);
      if (last.selection.from === last.selection.to) {
        return caret;
      }
      await sleep(30);
    }
  }
  throw new Error(`caret is in the paragraph: ${JSON.stringify(last)}`);
}

async function typeAddressAndOk(client, address) {
  await evaluate(client, `(() => {
    const field = document.querySelector('.link-dialog [data-link-address]');
    field.focus();
    field.select();
    return true;
  })()`);
  await client.send('Input.insertText', { text: address });
  await sleep(100);
  await click(client, await centerOf(client, '.link-dialog [data-link-ok]'));
}

test('right-click Link… on part of a word fills Text and links exactly that selection', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  // "Download" -> select "load" (offsets 4 to 8) on the second line.
  const { a, b } = await dragSelect(client, 1, 4, 8);
  const selected = await waitState(client, (state) => state.selection.to - state.selection.from === 4, 'drag selects load');
  const mid = { x: Math.round((a.x + b.x) / 2), y: a.y };
  await mouse(client, 'mouseMoved', mid);
  await mouse(client, 'mousePressed', mid, 'right');
  await mouse(client, 'mouseReleased', mid, 'right');
  const menu = await waitState(client, (state) => state.menu.some((label) => label.startsWith('Link')), 'right-click menu shows Link…');
  assert.deepEqual(menu.selection, selected.selection, 'the right-click keeps the selection');
  const item = await evaluate(client, `(() => {
    const node = [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent.startsWith('Link'));
    const rect = node.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  await click(client, item);
  const dialog = await waitState(client, (state) => state.dialog !== null, 'Link dialog opens');
  assert.equal(dialog.dialog.mode, 'insert');
  assert.equal(dialog.dialog.text, 'load');
  assert.equal(dialog.dialog.address, '');
  await typeAddressAndOk(client, TARGET);
  const done = await waitState(client, (state) => state.dialog === null && state.links.length === 1, 'OK links the selection');
  assert.deepEqual(done.lines, ['Install notes', 'Download it and run it.', 'Then pick a theme.']);
  assert.equal(done.links[0].text, 'load');
  assert.equal(done.links[0].address, TARGET);
  assert.equal(done.links[0].from, selected.selection.from);
  assert.equal(done.links[0].to, selected.selection.to);
});

test('Ctrl+K on a selection that crosses bold text links exactly that selection', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  // "Install notes" with "Install" bold -> select "stall no" (offsets 2 to 10).
  await dragSelect(client, 0, 2, 10);
  await waitState(client, (state) => state.selection.to - state.selection.from === 8, 'drag selects stall no');
  await key(client, 'k', 'KeyK', 75, 2);
  const dialog = await waitState(client, (state) => state.dialog !== null, 'Ctrl+K opens the dialog');
  assert.equal(dialog.dialog.text, 'stall no');
  await typeAddressAndOk(client, TARGET);
  const done = await waitState(client, (state) => state.dialog === null && state.links.length === 1, 'OK links the selection');
  assert.equal(done.lines[0], 'Install notes');
  assert.equal(done.links[0].text, 'stall no');
  assert.equal(done.links[0].from, 3);
  assert.equal(done.links[0].to, 11);
  // A link holds plain text in the file format, so only the unlinked part keeps its bold.
  assert.equal(done.bold, 'In');
});

test('changing the Text field replaces the selection with the new text as the link', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  // "Then pick a theme." -> select "theme" (offsets 12 to 17).
  await dragSelect(client, 2, 12, 17);
  await waitState(client, (state) => state.selection.to - state.selection.from === 5, 'drag selects theme');
  await key(client, 'k', 'KeyK', 75, 2);
  await waitState(client, (state) => state.dialog?.text === 'theme', 'Text holds the selection');
  await evaluate(client, `(() => {
    const field = document.querySelector('.link-dialog [data-link-text]');
    field.focus();
    field.select();
    return true;
  })()`);
  await client.send('Input.insertText', { text: 'color theme' });
  await typeAddressAndOk(client, TARGET);
  const done = await waitState(client, (state) => state.dialog === null && state.links.length === 1, 'OK links the new text');
  assert.equal(done.lines[2], 'Then pick a color theme.');
  assert.equal(done.links[0].text, 'color theme');
});

test('with no selection, Ctrl+K still inserts a new link at the caret', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  await click(client, await pointAt(client, 1, 12));
  await waitState(client, (state) => state.selection.from === state.selection.to, 'caret placed');
  await key(client, 'k', 'KeyK', 75, 2);
  const dialog = await waitState(client, (state) => state.dialog !== null, 'Ctrl+K opens the dialog');
  assert.equal(dialog.dialog.text, '');
  await evaluate(client, `(() => {
    const field = document.querySelector('.link-dialog [data-link-text]');
    field.focus();
    return true;
  })()`);
  await client.send('Input.insertText', { text: 'site ' });
  await typeAddressAndOk(client, TARGET);
  const done = await waitState(client, (state) => state.dialog === null && state.links.length === 1, 'OK inserts a link');
  assert.equal(done.links[0].text, 'site ');
  assert.equal(done.lines[1], 'Download it site and run it.');
});

async function menuItemBox(client, id) {
  const expression = `(() => {
    const host = document.querySelector('[data-region="context-menu"]');
    const node = host && host.querySelector(${JSON.stringify(`[data-item="${id}"]`)});
    if (!host || !node) {
      return null;
    }
    const rect = node.getBoundingClientRect();
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + rect.height / 2);
    const hit = document.elementFromPoint(x, y);
    return {
      x,
      y,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      disabled: node.getAttribute('aria-disabled'),
      placed: host.style.getPropertyValue('--context-menu-left') !== '',
      onItem: hit === node || (hit instanceof Node && node.contains(hit)),
    };
  })()`;
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  let last = null;
  let previous = '';
  let stable = 0;
  while (Date.now() < deadline) {
    last = await evaluate(client, expression);
    const key = last && last.placed && last.onItem && last.width > 0 && last.height > 0
      ? `${last.x}:${last.y}:${last.width}:${last.height}`
      : '';
    if (key !== '' && key === previous) {
      stable += 1;
      if (stable >= 2) {
        return last;
      }
    } else {
      stable = 0;
    }
    previous = key;
    await sleep(16);
  }
  throw new Error(`menu item ${id} was not ready: ${JSON.stringify(last)}`);
}

async function rootMenuLabels(client) {
  const expression = `(() => {
    const host = document.querySelector('[data-region="context-menu"]');
    if (!host) {
      return null;
    }
    const labels = [...host.querySelectorAll('.menu-panel--root .menu-label')].map((node) => node.textContent);
    return {
      placed: host.style.getPropertyValue('--context-menu-left') !== '',
      labels,
    };
  })()`;
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  let last = null;
  let previous = '';
  let stable = 0;
  while (Date.now() < deadline) {
    last = await evaluate(client, expression);
    const key = last && last.placed && last.labels.length > 0 ? JSON.stringify(last.labels) : '';
    if (key !== '' && key === previous) {
      stable += 1;
      if (stable >= 2) {
        return last.labels;
      }
    } else {
      stable = 0;
    }
    previous = key;
    await sleep(16);
  }
  throw new Error(`text menu was not ready: ${JSON.stringify(last)}`);
}

async function rememberClipboard(client) {
  await evaluate(client, `(() => {
    window.__copiedText = '';
    if (window.__copyListener) {
      return true;
    }
    const save = (event) => {
      const text = event.clipboardData ? event.clipboardData.getData('text/plain') : '';
      if (text) {
        window.__copiedText = text;
      }
    };
    document.addEventListener('copy', save);
    document.addEventListener('cut', save);
    window.__copyListener = true;
    return true;
  })()`);
}

function copiedText(client) {
  return evaluate(client, `window.__copiedText || ''`);
}

async function rightClick(client, point) {
  await mouse(client, 'mouseMoved', point);
  await mouse(client, 'mousePressed', point, 'right');
  await mouse(client, 'mouseReleased', point, 'right');
}

test('right-click inside a selection enables Cut and Copy', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  await rememberClipboard(client);
  const { a, b } = await dragSelect(client, 0, 8, 13);
  const selected = await waitState(client, (state) => state.selection.to - state.selection.from === 5, 'drag selects notes');
  const mid = { x: Math.round((a.x + b.x) / 2), y: a.y };
  await rightClick(client, mid);
  await waitState(client, (state) => state.menu.some((label) => label.startsWith('Copy')), 'right-click menu shows Copy');
  const kept = await evaluate(client, STATE);
  assert.deepEqual(kept.selection, selected.selection, 'the right-click keeps the selection');
  const copyItem = await menuItemBox(client, 'edit-copy');
  const cutItem = await menuItemBox(client, 'edit-cut');
  assert.equal(copyItem.disabled, null);
  assert.equal(cutItem.disabled, null);
  await click(client, copyItem);
  await waitState(client, (state) => state.contextOpen === false, 'Copy closes the menu');
  assert.equal(await copiedText(client), 'notes');
  const afterCopy = await evaluate(client, STATE);
  assert.equal(afterCopy.lines[0], 'Install notes');

  const start = await pointAt(client, 0, 8);
  const end = await pointAt(client, 0, 13);
  await rightClick(client, { x: Math.round((start.x + end.x) / 2), y: start.y });
  await waitState(client, (state) => state.menu.some((label) => label.startsWith('Cut')), 'right-click menu shows Cut');
  const cutAgain = await menuItemBox(client, 'edit-cut');
  assert.equal(cutAgain.disabled, null);
  await evaluate(client, `window.__copiedText = ''`);
  await click(client, cutAgain);
  const afterCut = await waitState(client, (state) => state.lines[0] === 'Install ', 'Cut removes the selection');
  assert.equal(await copiedText(client), 'notes');
  assert.equal(afterCut.selection.from, afterCut.selection.to);
  assert.equal(afterCut.selection.from, selected.selection.from);
});

async function dragSelectFast(client, line, from, to) {
  const a = await pointAt(client, line, from);
  const b = await pointAt(client, line, to);
  await mouse(client, 'mouseMoved', a);
  await mouse(client, 'mousePressed', a, 'left');
  await mouse(client, 'mouseMoved', b, 'left');
  await mouse(client, 'mouseReleased', b, 'left');
  return { a, b };
}

async function doubleClick(client, point) {
  await mouse(client, 'mouseMoved', point);
  await mouse(client, 'mousePressed', point, 'left', 0, 1);
  await mouse(client, 'mouseReleased', point, 'left', 0, 1);
  await mouse(client, 'mousePressed', point, 'left', 0, 2);
  await mouse(client, 'mouseReleased', point, 'left', 0, 2);
}

test('a drag then an immediate right-click keeps Cut and Copy enabled', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  const { a, b } = await dragSelectFast(client, 0, 8, 13);
  const mid = { x: Math.round((a.x + b.x) / 2), y: a.y };
  await rightClick(client, mid);
  await waitState(client, (state) => state.contextOpen && state.selection.to > state.selection.from, 'selection survives the right-click');
  const copyItem = await menuItemBox(client, 'edit-copy');
  const cutItem = await menuItemBox(client, 'edit-cut');
  assert.equal(copyItem.disabled, null);
  assert.equal(cutItem.disabled, null);
});

test('a double-click then an immediate right-click keeps Cut and Copy enabled', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  const point = await pointAt(client, 1, 3);
  await doubleClick(client, point);
  await rightClick(client, point);
  await waitState(client, (state) => state.contextOpen && state.selection.to - state.selection.from > 1, 'double-click selection stays');
  const copyItem = await menuItemBox(client, 'edit-copy');
  const cutItem = await menuItemBox(client, 'edit-cut');
  assert.equal(copyItem.disabled, null);
  assert.equal(cutItem.disabled, null);
});

test('Copy from the menu and Paste from the menu round-trip the text', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  const { a, b } = await dragUntilSelected(client, 0, 8, 13, 5, 'drag selects notes');
  const mid = { x: Math.round((a.x + b.x) / 2), y: a.y };
  await rightClick(client, mid);
  await waitState(client, (state) => state.contextOpen, 'copy menu open');
  const copyItem = await menuItemBox(client, 'edit-copy');
  assert.equal(copyItem.disabled, null);
  await click(client, copyItem);
  await waitState(client, (state) => state.contextOpen === false, 'copy menu closed');
  const caret = await placeTextCaret(client, 2, 0);
  await rightClick(client, caret);
  await waitState(client, (state) => state.contextOpen, 'paste menu open');
  const pasteItem = await menuItemBox(client, 'edit-paste');
  assert.equal(pasteItem.disabled, null);
  await click(client, pasteItem);
  const pasted = await waitState(
    client,
    (state) => state.contextOpen === false && state.lines[2].includes('notes'),
    'menu Paste inserts the copied text',
  );
  assert.equal(pasted.lines[2].includes('notes'), true);
});

test('the text menu offers Paste as plain text under Paste', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  const { a, b } = await dragUntilSelected(client, 0, 0, 7, 7, 'drag selects Install');
  const mid = { x: Math.round((a.x + b.x) / 2), y: a.y };
  await rightClick(client, mid);
  await waitState(client, (state) => state.contextOpen, 'text menu open');
  const labels = await rootMenuLabels(client);
  const pasteAt = labels.indexOf('Paste');
  assert.ok(pasteAt >= 0, 'Paste is in the text menu');
  assert.equal(labels[pasteAt + 1], 'Paste as plain text');
  const copyItem = await menuItemBox(client, 'edit-copy');
  assert.equal(copyItem.disabled, null);
  await click(client, copyItem);
  await waitState(client, (state) => state.contextOpen === false, 'copy closes');
  const caret = await placeTextCaret(client, 2, 0);
  await rightClick(client, caret);
  await waitState(client, (state) => state.contextOpen, 'paste menu open');
  const plain = await menuItemBox(client, 'edit-paste-plain');
  assert.equal(plain.disabled, null);
  await click(client, plain);
  const pasted = await waitState(
    client,
    (state) => state.contextOpen === false && state.lines[2].includes('Install') && state.bold === 'Install',
    'plain paste keeps the words and drops bold',
  );
  assert.equal(pasted.bold, 'Install');
  assert.equal(pasted.lines[2].includes('Install'), true);
});

test('a double-click outside an open menu selects the word', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  const margin = await evaluate(client, `(() => {
    const rect = document.querySelector('[data-region="page-editor"]').getBoundingClientRect();
    return { x: Math.round(rect.right - 8), y: Math.round(rect.top + 24) };
  })()`);
  await rightClick(client, margin);
  await waitState(client, (state) => state.contextOpen, 'menu open');
  const word = await pointAt(client, 1, 3);
  await doubleClick(client, word);
  const selected = await waitState(
    client,
    (state) => state.contextOpen === false && state.selection.to - state.selection.from >= 8,
    'double-click selects Download',
  );
  assert.equal(selected.contextOpen, false);
  assert.ok(selected.selection.to - selected.selection.from >= 8);
});

test('Cut and Copy stay disabled when nothing is selected', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  const point = await pointAt(client, 1, 12);
  await click(client, point);
  await waitState(client, (state) => state.selection.from === state.selection.to, 'caret placed');
  await rightClick(client, point);
  await waitState(client, (state) => state.menu.some((label) => label.startsWith('Copy')), 'right-click menu shows Copy');
  const copyItem = await menuItemBox(client, 'edit-copy');
  const cutItem = await menuItemBox(client, 'edit-cut');
  assert.equal(copyItem.disabled, 'true');
  assert.equal(cutItem.disabled, 'true');
  const caret = await evaluate(client, STATE);
  assert.equal(caret.selection.from, caret.selection.to);
});
