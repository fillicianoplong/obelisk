import assert from 'node:assert/strict';
import { mkdtemp, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  closeElectron,
  debuggerTargets,
  electronBinary,
  freePort,
  launchWithSandboxFallback,
  repoRoot,
  sleep,
  waitFor,
} from '../electron-launch.mjs';

const LAUNCH_LIMIT_MS = 3_000;

const SHELL_EXPRESSION = `(() => {
  const menu = document.querySelector('[data-region="menu-bar"]');
  const tabs = document.querySelector('[data-region="tab-strip"]');
  const page = document.querySelector('[data-region="page"]');
  const editor = document.querySelector('[data-region="page-editor"]');
  const status = document.querySelector('[data-region="status-bar"]');
  if (!menu || !tabs || !page || !editor || !status) {
    return null;
  }
  const box = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      top: rect.top,
      width: rect.width,
      height: rect.height,
      hidden: style.display === 'none' || style.visibility === 'hidden',
    };
  };
  const regions = {
    menu: box(menu),
    tabs: box(tabs),
    page: box(page),
    status: box(status),
  };
  for (const region of Object.values(regions)) {
    if (region.hidden || region.width < 1 || region.height < 1) {
      return null;
    }
  }
  if (editor.tagName !== 'TEXTAREA' || editor.disabled || editor.readOnly) {
    return null;
  }
  const tabNodes = [...tabs.querySelectorAll('[role="tab"]')];
  const active = tabs.querySelector('[role="tab"][aria-selected="true"]');
  return {
    title: document.title,
    regions,
    menuLabels: [...menu.querySelectorAll('[data-menu]')].map((element) => element.textContent.trim()),
    tabLabels: tabNodes.map((element) => element.getAttribute('data-title')),
    activeTitle: active ? active.getAttribute('data-title') : null,
    statusText: (status.textContent || '').trim(),
    editorValue: editor.value,
  };
})()`;

function cdp(wsUrl) {
  const Socket = globalThis.WebSocket;
  if (typeof Socket !== 'function') {
    throw new Error('This Node version has no WebSocket client.');
  }
  const ws = new Socket(wsUrl);
  let nextId = 1;
  const pending = new Map();

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    const resolver = pending.get(message.id);
    if (!resolver) {
      return;
    }
    pending.delete(message.id);
    if (message.error) {
      resolver.reject(new Error(JSON.stringify(message.error)));
      return;
    }
    resolver.resolve(message.result);
  });

  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', () => reject(new Error('DevTools socket failed.')));
  });

  return {
    url: wsUrl,
    async send(method, params = {}) {
      await opened;
      const id = nextId;
      nextId += 1;
      const result = new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
      ws.send(JSON.stringify({ id, method, params }));
      return result;
    },
    close() {
      ws.close();
    },
  };
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails));
  }
  return result.result.value;
}

async function readShell(port, session) {
  const pages = (await debuggerTargets(port)).filter(
    (target) => target.type === 'page' && typeof target.webSocketDebuggerUrl === 'string',
  );
  if (pages.length !== 1) {
    return null;
  }
  const url = pages[0].webSocketDebuggerUrl;
  if (!session.client || session.client.url !== url) {
    session.client?.close();
    session.client = cdp(url);
  }
  try {
    return await evaluate(session.client, SHELL_EXPRESSION);
  } catch (error) {
    session.client?.close();
    session.client = undefined;
    throw error;
  }
}

async function launchShell(userDataDir, port) {
  const binary = electronBinary();
  const args = ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`];
  const session = { client: undefined };
  let elapsed = 0;
  const child = await launchWithSandboxFallback({
    binary,
    args,
    ready(running) {
      session.client?.close();
      session.client = undefined;
      const started = Date.now();
      return waitFor(
        running,
        async () => {
          const state = await readShell(port, session);
          if (!state) {
            return null;
          }
          elapsed = Date.now() - started;
          return state;
        },
        20_000,
      );
    },
  });
  return { child, session, elapsed };
}

const SKIP_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'coverage', 'docs']);

async function listFiles(directory) {
  const files = [];
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'EPERM' || error?.code === 'EBUSY') {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const fileStat = await stat(full);
        files.push(`${path.relative(directory, full)}:${fileStat.size}`);
      }
    }
  }
  await walk(directory);
  return files.sort();
}

async function settleFiles(directory) {
  let previous = await listFiles(directory);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await sleep(200);
    const next = await listFiles(directory);
    if (next.join('\n') === previous.join('\n')) {
      return next;
    }
    previous = next;
  }
  return previous;
}

function fileDiff(before, after) {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter((file) => !beforeSet.has(file)),
    removed: before.filter((file) => !afterSet.has(file)),
  };
}

async function findObkFiles(directory, depth = 0) {
  if (depth > 8) {
    return [];
  }
  const found = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'EPERM') {
      return found;
    }
    throw error;
  }
  for (const entry of entries) {
    if (SKIP_DIRECTORIES.has(entry.name)) {
      continue;
    }
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await findObkFiles(full, depth + 1)));
    } else if (entry.isFile() && (entry.name.endsWith('.obk') || entry.name.includes('.~obk-'))) {
      found.push(full);
    }
  }
  return found;
}

function assertRegions(state) {
  assert.equal(state.title, 'Obelisk');
  assert.deepEqual(state.menuLabels, ['File', 'Edit', 'View', 'Insert', 'Format', 'Tools', 'Help']);
  assert.ok(state.regions.menu.top < state.regions.tabs.top, 'menu bar is above the tab strip');
  assert.ok(state.regions.tabs.top < state.regions.page.top, 'tab strip is above the page');
  assert.ok(state.regions.page.top < state.regions.status.top, 'page is above the status bar');
  assert.match(state.statusText, /Not saved/);
}

async function chooseFileNew(client, expectedCount) {
  const result = await evaluate(
    client,
    `(async () => {
      const file = document.querySelector('[data-menu="file"]');
      if (!file) {
        return 'missing File menu';
      }
      file.click();
      const opened = Date.now() + 1000;
      let item = null;
      while (Date.now() < opened) {
        item = document.querySelector('[data-region="menu-bar"] [data-command="new"]');
        const rect = item ? item.getBoundingClientRect() : null;
        if (item && !item.disabled && rect.width > 0 && rect.height > 0) {
          break;
        }
        item = null;
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      if (!item) {
        return 'missing File > New';
      }
      item.click();
      const added = Date.now() + 1000;
      while (Date.now() < added) {
        const titles = [...document.querySelectorAll('[role="tab"]')].map((tab) => tab.getAttribute('data-title'));
        if (titles.length === ${expectedCount}) {
          return 'ok';
        }
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return 'File > New did not open a tab';
    })()`,
  );
  assert.equal(result, 'ok', result);
}

async function replacePageText(client, text) {
  const value = await evaluate(
    client,
    `(() => {
      const editor = document.querySelector('[data-region="page-editor"]');
      if (!editor) {
        return null;
      }
      editor.focus();
      const prototype = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
      prototype.set.call(editor, ${JSON.stringify(text)});
      editor.dispatchEvent(new Event('input', { bubbles: true }));
      return editor.value;
    })()`,
  );
  assert.equal(value, text);
}

async function selectTab(client, tabId) {
  const title = await evaluate(
    client,
    `(async () => {
      const tab = document.querySelector('[data-tab-id=${JSON.stringify(tabId)}]');
      if (!tab) {
        return null;
      }
      const expected = tab.getAttribute('data-title');
      tab.click();
      const deadline = Date.now() + 1000;
      while (Date.now() < deadline) {
        const active = document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-title') ?? null;
        const editor = document.querySelector('[data-region="page-editor"]');
        if (active === expected && editor) {
          return { active, value: editor.value };
        }
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return { active: null, value: null };
    })()`,
  );
  assert.ok(title, `missing tab ${tabId}`);
  return title;
}

test('launch shows the four shell regions and an editable tab within 3 seconds', { timeout: 60_000 }, async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-shell-launch-'));
  const port = await freePort();
  let child;
  let session;

  try {
    const launched = await launchShell(userDataDir, port);
    child = launched.child;
    session = launched.session;
    const state = await readShell(port, session);
    assert.ok(state, 'the shell did not render');
    console.log(`NFR-01 launch to editable tab: ${launched.elapsed} ms`);
    assert.ok(
      launched.elapsed < LAUNCH_LIMIT_MS,
      `NFR-01 launch to editable tab took ${launched.elapsed} ms, limit is ${LAUNCH_LIMIT_MS} ms`,
    );
    assertRegions(state);
    assert.deepEqual(state.tabLabels, ['Untitled 1']);
    assert.equal(state.activeTitle, 'Untitled 1');
    assert.equal(state.editorValue, '');
    assert.equal(state.statusText, 'Page 1 of 1 - 0 words - 0 characters - 100% - Not saved');
    const pages = (await debuggerTargets(port)).filter((target) => target.type === 'page');
    assert.equal(pages.length, 1);
  } finally {
    session?.client?.close();
    await closeElectron(child, userDataDir);
  }
});

test('File > New adds a never-saved tab and writes no file', { timeout: 60_000 }, async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-shell-new-'));
  const port = await freePort();
  let child;
  let session;

  try {
    const launched = await launchShell(userDataDir, port);
    child = launched.child;
    session = launched.session;
    const beforeFiles = await settleFiles(userDataDir);
    const beforeObk = [
      ...(await findObkFiles(userDataDir)),
      ...(await findObkFiles(repoRoot)),
    ];
    assert.deepEqual(beforeObk, []);

    await replacePageText(session.client, 'First page notes');
    let state = await readShell(port, session);
    assert.equal(state.editorValue, 'First page notes');
    assert.equal(state.statusText, 'Page 1 of 1 - 3 words - 16 characters - 100% - Not saved');

    await chooseFileNew(session.client, 2);
    state = await readShell(port, session);
    assert.deepEqual(state.tabLabels, ['Untitled 1', 'Untitled 2']);
    assert.equal(state.activeTitle, 'Untitled 2');
    assert.equal(state.editorValue, '');
    assert.match(state.statusText, /Not saved/);

    await replacePageText(session.client, 'Second page');
    await chooseFileNew(session.client, 3);
    state = await readShell(port, session);
    assert.deepEqual(state.tabLabels, ['Untitled 1', 'Untitled 2', 'Untitled 3']);
    assert.equal(state.activeTitle, 'Untitled 3');
    assert.equal(state.editorValue, '');

    const firstTab = await selectTab(session.client, 'untitled-1');
    assert.equal(firstTab.active, 'Untitled 1');
    assert.equal(firstTab.value, 'First page notes');
    const secondTab = await selectTab(session.client, 'untitled-2');
    assert.equal(secondTab.active, 'Untitled 2');
    assert.equal(secondTab.value, 'Second page');

    const afterFiles = await settleFiles(userDataDir);
    const diff = fileDiff(beforeFiles, afterFiles);
    assert.deepEqual(diff, { added: [], removed: [] }, JSON.stringify(diff));
    const afterObk = [
      ...(await findObkFiles(userDataDir)),
      ...(await findObkFiles(repoRoot)),
    ];
    assert.deepEqual(afterObk, []);
  } finally {
    session?.client?.close();
    await closeElectron(child, userDataDir);
  }
});
