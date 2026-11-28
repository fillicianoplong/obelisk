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
  freePort,
  launchWithSandboxFallback,
  openCdp,
  sleep,
  STEP_TIMEOUT_MS,
  waitFor,
} from '../electron-launch.mjs';

const READY = `(() => {
  const editor = document.querySelector('[data-region="page-editor"]');
  const menu = document.querySelector('[role="menubar"]');
  if (!editor || !menu || editor.getAttribute('contenteditable') !== 'true') {
    return null;
  }
  if (document.documentElement.dataset.shellCommands !== 'ready') {
    return null;
  }
  if (document.querySelector('[data-page="start"]') && !document.querySelector('[data-region="page-editor"]')) {
    document.querySelector('.start-action-primary')?.click();
  }
  return true;
})()`;

const SNAPSHOT = `(() => {
  const host = document.querySelector('[data-region="context-menu"]');
  if (!host) {
    return { open: false };
  }
  const labels = [...host.querySelectorAll('.menu-panel--root .menu-item .menu-label')].map((node) => node.textContent);
  const flyoutLabels = [...document.querySelectorAll('[data-region="context-menu-flyouts"] .menu-item .menu-label')].map((node) => node.textContent);
  const turnInto = host.querySelector('[data-item="block-turn-into"]');
  return {
    open: true,
    kind: host.getAttribute('data-context-kind'),
    blockType: host.getAttribute('data-context-block-type'),
    labels,
    flyoutLabels,
    focused: document.querySelector('.menu-item[data-focused="true"]')?.getAttribute('data-item') ?? null,
    turnIntoOpen: turnInto ? turnInto.getAttribute('data-open') : null,
    turnIntoChild: document.querySelector('[data-region="context-menu-flyouts"] [data-item="block-turn-into-text"]') !== null,
  };
})()`;

const ITEM_RECTS = `(() => {
  const host = document.querySelector('[data-region="context-menu"]');
  if (!host) {
    return null;
  }
  return [...host.querySelectorAll('.menu-panel--root .menu-item[data-item]')].map((node) => {
    const rect = node.getBoundingClientRect();
    return { id: node.getAttribute('data-item'), top: Math.round(rect.top), height: Math.round(rect.height) };
  });
})()`;

const FOCUS_SNAPSHOT = `(() => {
  const editor = document.querySelector('[data-region="page-editor"]');
  const active = document.activeElement;
  return {
    activeIsEditor: active === editor,
    editorFocusSource: editor ? editor.getAttribute('data-focus-source') : null,
    menuOpen: document.querySelector('[data-region="context-menu"]') !== null,
  };
})()`;

async function openPage(port, session) {
  const page = (await debuggerTargets(port)).find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
  assert.ok(page, 'the page has no DevTools socket');
  if (!session.client || session.client.url !== page.webSocketDebuggerUrl) {
    session.client?.close();
    session.client = openCdp(page.webSocketDebuggerUrl);
  }
  return session.client;
}

async function pressKey(client, key, code, virtualKey, modifiers = 0) {
  const shift = (modifiers & 8) !== 0;
  if (shift) {
    await client.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Shift',
      code: 'ShiftLeft',
      windowsVirtualKeyCode: 16,
      nativeVirtualKeyCode: 16,
    });
  }
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code,
    windowsVirtualKeyCode: virtualKey,
    nativeVirtualKeyCode: virtualKey,
    modifiers,
  });
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code,
    windowsVirtualKeyCode: virtualKey,
    nativeVirtualKeyCode: virtualKey,
    modifiers,
  });
  if (shift) {
    await client.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Shift',
      code: 'ShiftLeft',
      windowsVirtualKeyCode: 16,
      nativeVirtualKeyCode: 16,
    });
  }
}

async function waitForMenu(client, predicate, label) {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    last = await evaluate(client, SNAPSHOT);
    if (predicate(last)) {
      return last;
    }
    await sleep(30);
  }
  throw new Error(`${label} did not match within ${STEP_TIMEOUT_MS} ms: ${JSON.stringify(last)}`);
}

async function launchApp(t) {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-context-menu-'));
  const session = { child: undefined, client: undefined, userDataDir };
  bindLaunchedApp(t, session);
  const port = await freePort();
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
          const client = await openPage(port, session);
          return evaluate(client, READY);
        },
        20_000,
      );
    },
  });
  return { client: await openPage(port, session) };
}

const BLOCK_POINT = {
  paragraph: `(() => {
    const editor = document.querySelector('[data-region="page-editor"]');
    const p = editor.querySelector('p[data-block-id]');
    const node = p ?? editor;
    const rect = node.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + Math.min(16, rect.height / 2)) };
  })()`,
  heading: `(() => {
    const node = document.querySelector('[data-region="page-editor"] [data-level]');
    if (!node) {
      throw new Error('heading block is missing');
    }
    const rect = node.getBoundingClientRect();
    return { x: Math.round(rect.left + 12), y: Math.round(rect.top + 12) };
  })()`,
  'bulleted-list': `(() => {
    const node = document.querySelector('[data-region="page-editor"] ul[data-list-style="bulleted"] li[data-list-item]');
    if (!node) {
      throw new Error('bulleted list item is missing');
    }
    const rect = node.getBoundingClientRect();
    return {
      x: Math.round(rect.left + Math.max(28, rect.width / 3)),
      y: Math.round(rect.top + Math.min(12, rect.height / 2)),
    };
  })()`,
  quote: `(() => {
    const node = document.querySelector('[data-region="page-editor"] blockquote');
    if (!node) {
      throw new Error('quote block is missing');
    }
    const rect = node.getBoundingClientRect();
    return { x: Math.round(rect.left + 12), y: Math.round(rect.top + 12) };
  })()`,
  code: `(() => {
    const node = document.querySelector('[data-region="page-editor"] pre[data-code-block]');
    if (!node) {
      throw new Error('code block is missing');
    }
    const rect = node.getBoundingClientRect();
    return { x: Math.round(rect.left + 12), y: Math.round(rect.top + 12) };
  })()`,
};

async function editorPoint(client, blockType) {
  const script = BLOCK_POINT[blockType] ?? BLOCK_POINT.paragraph;
  return evaluate(client, script);
}

async function rightClick(client, point) {
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'right', clickCount: 1 });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'right', clickCount: 1 });
}

async function rightClickBlockHandle(client) {
  const point = await evaluate(
    client,
    `(() => {
      const handle = document.querySelector('.block-handle-layer .block-handle:not([hidden])');
      if (!handle) {
        throw new Error('block handle is missing');
      }
      const rect = handle.getBoundingClientRect();
      return { x: Math.round(rect.left + 4), y: Math.round(rect.top + 8) };
    })()`,
  );
  await rightClick(client, point);
}

async function selectBlock(client) {
  await evaluate(
    client,
    `(() => {
      const editor = document.querySelector('[data-region="page-editor"]');
      editor.focus();
      const rect = editor.getBoundingClientRect();
      editor.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: rect.left + 8, clientY: rect.top + 24 }));
      const handle = document.querySelector('.block-handle-layer .block-handle');
      if (handle) {
        handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
        handle.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
        handle.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
      }
    })()`,
  );
  await sleep(80);
}

const BLOCK_TYPES = [
  {
    name: 'paragraph',
    setup: `editor.editorCommands.replaceText('Paragraph text');`,
    kind: 'text',
    blockType: 'paragraph',
    label: 'Spelling suggestions',
  },
  {
    name: 'heading',
    setup: `editor.editorCommands.replaceText('');
      editor.editorCommands.insertBlock('heading', { level: 1 });
      editor.editorCommands.focusBlock(1);`,
    kind: 'text',
    blockType: 'heading',
    label: 'Spelling suggestions',
  },
  {
    name: 'bulleted-list',
    setup: `editor.editorCommands.replaceText('');
      editor.editorCommands.insertBlock('bulleted-list');
      editor.editorCommands.focusBlock(1);`,
    kind: 'text',
    blockType: 'bulleted-list',
    label: 'Spelling suggestions',
  },
  {
    name: 'quote',
    setup: `editor.editorCommands.replaceText('');
      editor.editorCommands.insertBlock('quote');
      editor.editorCommands.focusBlock(1);`,
    kind: 'text',
    blockType: 'quote',
    label: 'Spelling suggestions',
  },
  {
    name: 'code',
    setup: `editor.editorCommands.replaceText('');
      editor.editorCommands.insertBlock('code');
      editor.editorCommands.focusBlock(1);`,
    kind: 'text',
    blockType: 'code',
    label: 'Spelling suggestions',
  },
];

for (const blockCase of BLOCK_TYPES) {
  test(`${blockCase.name}: right-click and Shift+F10 share kind, block type, and labels`, { timeout: 60_000 }, async (t) => {
    const { client } = await launchApp(t);
    await evaluate(
      client,
      `(() => {
        const editor = document.querySelector('[data-region="page-editor"]');
        editor.focus();
        ${blockCase.setup}
      })()`,
    );
    const point = await editorPoint(client, blockCase.blockType);
    const prepareKeyboard = async () => {
      await evaluate(
        client,
        `(() => {
          const editor = document.querySelector('[data-region="page-editor"]');
          editor.focus();
          editor.editorCommands.focusBlock(${blockCase.blockType === 'paragraph' ? 0 : 1});
        })()`,
      );
      await sleep(80);
      await pressKey(client, 'F10', 'F10', 121, 8);
      return waitForMenu(
        client,
        (state) => state.open && state.kind === blockCase.kind && state.blockType === blockCase.blockType,
        `${blockCase.name} Shift+F10`,
      );
    };
    const preparePointer = async () => {
      await rightClick(client, point);
      return waitForMenu(
        client,
        (state) => state.open && state.kind === blockCase.kind && state.blockType === blockCase.blockType,
        `${blockCase.name} right-click`,
      );
    };
    let right;
    let keyboard;
    right = await preparePointer();
    assert.ok(right.labels.includes(blockCase.label), right.labels.join(', '));
    await pressKey(client, 'Escape', 'Escape', 27);
    await sleep(80);
    keyboard = await prepareKeyboard();
    assert.deepEqual(keyboard.labels, right.labels);
    assert.deepEqual(keyboard.blockType, right.blockType);
  });
}

test('opening Turn into does not move root menu items', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  await evaluate(
    client,
    `(() => {
      const editor = document.querySelector('[data-region="page-editor"]');
      editor.focus();
      editor.editorCommands.replaceText('');
      editor.editorCommands.insertBlock('heading', { level: 1 });
      editor.editorCommands.focusBlock(1);
    })()`,
  );
  const point = await editorPoint(client, 'heading');
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none' });
  await sleep(80);
  await rightClickBlockHandle(client);
  await waitForMenu(client, (state) => state.open && state.kind === 'block', 'block menu');
  const before = await evaluate(client, ITEM_RECTS);
  let focused = '';
  for (let index = 0; index < 10; index += 1) {
    await pressKey(client, 'ArrowDown', 'ArrowDown', 40);
    const snap = await evaluate(client, SNAPSHOT);
    focused = snap.focused ?? '';
    if (focused === 'block-turn-into') {
      break;
    }
  }
  assert.equal(focused, 'block-turn-into');
  await pressKey(client, 'ArrowRight', 'ArrowRight', 39);
  await waitForMenu(client, (state) => state.turnIntoOpen === 'true' && state.turnIntoChild === true, 'flyout open');
  const after = await evaluate(client, ITEM_RECTS);
  assert.deepEqual(after, before);
  const flyoutGap = await evaluate(
    client,
    `(() => {
      const root = document.querySelector('[data-region="context-menu"] .menu-panel--root');
      const flyout = document.querySelector('[data-region="context-menu-flyouts"] .menu-flyout');
      if (!root || !flyout) {
        return null;
      }
      return Math.round(flyout.getBoundingClientRect().left - root.getBoundingClientRect().right);
    })()`,
  );
  assert.ok(flyoutGap !== null && flyoutGap >= 4, `flyout gap was ${flyoutGap}`);
});

test('Escape returns focus to the editor without the page focus ring', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  await evaluate(
    client,
    `(() => {
      const editor = document.querySelector('[data-region="page-editor"]');
      editor.focus();
      editor.editorCommands.replaceText('Focus me');
    })()`,
  );
  const point = await editorPoint(client, 'paragraph');
  await rightClick(client, point);
  await waitForMenu(client, (state) => state.open && state.kind === 'text', 'text menu');
  await pressKey(client, 'Escape', 'Escape', 27);
  await sleep(120);
  let focus = await evaluate(client, FOCUS_SNAPSHOT);
  assert.equal(focus.menuOpen, false);
  assert.equal(focus.activeIsEditor, true);
  assert.equal(focus.editorFocusSource, null);
  await selectBlock(client);
  await pressKey(client, 'F10', 'F10', 121, 8);
  await waitForMenu(client, (state) => state.open, 'keyboard menu');
  await pressKey(client, 'Escape', 'Escape', 27);
  await sleep(120);
  focus = await evaluate(client, FOCUS_SNAPSHOT);
  assert.equal(focus.activeIsEditor, true);
  assert.equal(focus.editorFocusSource, null);
});

test('Turn into opens with ArrowRight in the flyout layer', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  await evaluate(
    client,
    `(() => {
      const editor = document.querySelector('[data-region="page-editor"]');
      editor.focus();
      editor.editorCommands.replaceText('');
      editor.editorCommands.insertBlock('heading', { level: 1 });
      editor.editorCommands.focusBlock(1);
    })()`,
  );
  const point = await editorPoint(client, 'heading');
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none' });
  await sleep(80);
  await rightClickBlockHandle(client);
  await waitForMenu(client, (state) => state.open && state.kind === 'block', 'context menu');
  let focused = '';
  for (let index = 0; index < 10; index += 1) {
    await pressKey(client, 'ArrowDown', 'ArrowDown', 40);
    const snap = await evaluate(client, SNAPSHOT);
    focused = snap.focused ?? '';
    if (focused === 'block-turn-into') {
      break;
    }
  }
  assert.equal(focused, 'block-turn-into');
  await pressKey(client, 'ArrowRight', 'ArrowRight', 39);
  const nested = await waitForMenu(
    client,
    (state) => state.open === true && state.turnIntoOpen === 'true' && state.turnIntoChild === true,
    'Turn into submenu',
  );
  assert.ok(nested.flyoutLabels.includes('Text'));
});

test('block handle on a paragraph opens the block menu', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  await evaluate(
    client,
    `(() => {
      const editor = document.querySelector('[data-region="page-editor"]');
      editor.focus();
      editor.editorCommands.replaceText('Paragraph');
    })()`,
  );
  const point = await editorPoint(client, 'paragraph');
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none' });
  await sleep(80);
  await rightClickBlockHandle(client);
  await waitForMenu(client, (state) => state.open && state.kind === 'block' && state.blockType === 'paragraph', 'block menu');
  assert.ok((await evaluate(client, SNAPSHOT)).labels.includes('Turn into'));
});

test('Esc then Shift+F10 opens the block menu', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  await evaluate(
    client,
    `(() => {
      const editor = document.querySelector('[data-region="page-editor"]');
      editor.focus();
      editor.editorCommands.replaceText('Block target');
    })()`,
  );
  await pressKey(client, 'Escape', 'Escape', 27);
  await sleep(80);
  await pressKey(client, 'F10', 'F10', 121, 8);
  const menu = await waitForMenu(client, (state) => state.open && state.kind === 'block', 'block menu after Esc');
  assert.ok(menu.labels.includes('Turn into'));
});

const SHELL_ALIVE = `(() => {
  const editor = document.querySelector('[data-region="page-editor"]');
  const menuBar = document.querySelector('[role="menubar"]');
  const shell = document.querySelector('.shell');
  return {
    editorPresent: Boolean(editor),
    editable: editor?.getAttribute('contenteditable') === 'true',
    text: editor?.textContent ?? '',
    menuBarPresent: Boolean(menuBar),
    shellPresent: Boolean(shell),
  };
})()`;

test('right-clicking empty document space keeps the shell and editor visible', { timeout: 90_000 }, async (t) => {
  const { client } = await launchApp(t);
  await evaluate(
    client,
    `(() => {
      const editor = document.querySelector('[data-region="page-editor"]');
      editor.focus();
      editor.editorCommands.replaceText('Hello');
    })()`,
  );
  const points = await evaluate(
    client,
    `(() => {
      const editor = document.querySelector('[data-region="page-editor"]');
      const region = document.querySelector('[data-region="page"]');
      const er = editor.getBoundingClientRect();
      const rr = region?.getBoundingClientRect() ?? er;
      return [
        { label: 'below', x: Math.round(er.left + 40), y: Math.round(er.bottom + 60) },
        { label: 'right-gutter', x: Math.round(er.right - 12), y: Math.round(er.top + 40) },
        { label: 'page-padding', x: Math.round(rr.right - 8), y: Math.round(rr.top + rr.height / 2) },
      ];
    })()`,
  );
  for (const point of points) {
    await pressKey(client, 'Escape', 'Escape', 27);
    await sleep(40);
    await rightClick(client, point);
    await sleep(150);
    const alive = await evaluate(client, SHELL_ALIVE);
    assert.equal(alive.editorPresent, true, `${point.label}: editor missing`);
    assert.equal(alive.editable, true, `${point.label}: editor not editable`);
    assert.equal(alive.shellPresent, true, `${point.label}: shell missing`);
    assert.equal(alive.menuBarPresent, true, `${point.label}: menu bar missing`);
    assert.equal(alive.text, 'Hello', `${point.label}: text changed`);
  }
});

test('pointer down outside the block menu closes it', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  await evaluate(
    client,
    `(() => {
      const editor = document.querySelector('[data-region="page-editor"]');
      editor.focus();
      editor.editorCommands.replaceText('Dismiss me');
    })()`,
  );
  const point = await editorPoint(client, 'paragraph');
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none' });
  await sleep(80);
  await rightClickBlockHandle(client);
  await waitForMenu(client, (state) => state.open && state.kind === 'block', 'block menu');
  const inside = await editorPoint(client, 'paragraph');
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: inside.x,
    y: inside.y,
    button: 'left',
    clickCount: 1,
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: inside.x,
    y: inside.y,
    button: 'left',
    clickCount: 1,
  });
  await sleep(120);
  const snap = await evaluate(client, SNAPSHOT);
  assert.equal(snap.open, false);
});

test('pointer down on the menu bar closes the block menu', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  await evaluate(
    client,
    `(() => {
      const editor = document.querySelector('[data-region="page-editor"]');
      editor.focus();
      editor.editorCommands.replaceText('Menu bar');
    })()`,
  );
  const point = await editorPoint(client, 'paragraph');
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none' });
  await sleep(80);
  await rightClickBlockHandle(client);
  await waitForMenu(client, (state) => state.open && state.kind === 'block', 'block menu');
  const bar = await evaluate(
    client,
  `(() => {
      const bar = document.querySelector('[role="menubar"]');
      const rect = bar.getBoundingClientRect();
      return { x: Math.round(rect.left + 8), y: Math.round(rect.top + 8) };
    })()`,
  );
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: bar.x,
    y: bar.y,
    button: 'left',
    clickCount: 1,
  });
  await sleep(120);
  const snap = await evaluate(client, SNAPSHOT);
  assert.equal(snap.open, false);
});

test('Escape on the block menu restores the caret without the page focus ring', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  await evaluate(
    client,
    `(() => {
      const editor = document.querySelector('[data-region="page-editor"]');
      editor.focus();
      editor.editorCommands.replaceText('Ring check');
    })()`,
  );
  await pressKey(client, 'Escape', 'Escape', 27);
  await sleep(80);
  await pressKey(client, 'F10', 'F10', 121, 8);
  await waitForMenu(client, (state) => state.open && state.kind === 'block', 'block menu');
  await pressKey(client, 'Escape', 'Escape', 27);
  await sleep(120);
  const focus = await evaluate(client, FOCUS_SNAPSHOT);
  assert.equal(focus.menuOpen, false);
  assert.equal(focus.activeIsEditor, true);
  assert.equal(focus.editorFocusSource, null);
});

test('outside click then Escape on the block menu leaves no page focus ring', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  await evaluate(
    client,
    `(() => {
      const editor = document.querySelector('[data-region="page-editor"]');
      editor.focus();
      editor.editorCommands.replaceText('Outside ring');
    })()`,
  );
  const point = await editorPoint(client, 'paragraph');
  await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none' });
  await sleep(80);
  await rightClickBlockHandle(client);
  await waitForMenu(client, (state) => state.open && state.kind === 'block', 'block menu');
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
  await sleep(120);
  await pressKey(client, 'Escape', 'Escape', 27);
  await sleep(120);
  const focus = await evaluate(client, FOCUS_SNAPSHOT);
  assert.equal(focus.menuOpen, false);
  assert.equal(focus.activeIsEditor, true);
  assert.equal(focus.editorFocusSource, null);
});

test('resize and a window blur close the context menu where it opened', { timeout: 60_000 }, async (t) => {
  const { client } = await launchApp(t);
  await evaluate(client, `(() => {
    const editor = document.querySelector('[data-region="page-editor"]');
    editor.focus();
    editor.editorCommands.replaceText('Close me');
  })()`);
  const point = await editorPoint(client, 'paragraph');
  await rightClick(client, point);
  await waitForMenu(client, (state) => state.open, 'menu open');
  const before = await evaluate(client, `(() => {
    const host = document.querySelector('[data-region="context-menu"]');
    return {
      left: host.style.getPropertyValue('--context-menu-left'),
      top: host.style.getPropertyValue('--context-menu-top'),
    };
  })()`);
  await sleep(80);
  const afterHover = await evaluate(client, `(() => {
    const host = document.querySelector('[data-region="context-menu"]');
    const item = host.querySelector('.menu-item');
    item.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    return {
      left: host.style.getPropertyValue('--context-menu-left'),
      top: host.style.getPropertyValue('--context-menu-top'),
    };
  })()`);
  assert.equal(afterHover.left, before.left);
  assert.equal(afterHover.top, before.top);
  await evaluate(client, `window.dispatchEvent(new Event('resize'))`);
  await waitForMenu(client, (state) => !state.open, 'resize closes the menu');
  await rightClick(client, point);
  await waitForMenu(client, (state) => state.open, 'menu open again');
  await evaluate(client, `window.dispatchEvent(new Event('blur'))`);
  await waitForMenu(client, (state) => !state.open, 'blur closes the menu');
});