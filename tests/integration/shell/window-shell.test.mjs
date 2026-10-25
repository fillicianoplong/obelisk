import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
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
  repoRoot,
  sleep,
  STEP_TIMEOUT_MS,
  waitFor,
} from '../electron-launch.mjs';

const LAUNCH_LIMIT_MS = 3_000;

const SHELL_EXPRESSION = `(() => {
  const menu = document.querySelector('[data-region="menu-bar"]');
  const tabs = document.querySelector('[data-region="tab-strip"]');
  const page = document.querySelector('[data-region="page"]');
  const editor = document.querySelector('[data-region="page-editor"]');
  const status = document.querySelector('[data-region="status-bar"]');
  if (document.documentElement.dataset.shellCommands !== 'ready') {
    return null;
  }
  if (!menu || !tabs || !page || !editor || !status || !editor.editorCommands) {
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
  const paragraphs = [...editor.querySelectorAll(':scope > p')];
  if (editor.getAttribute('contenteditable') !== 'true' || paragraphs.length === 0) {
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
    editorValue: paragraphs.map((block) => (block.textContent || '').replace(/\\u200b/g, '')).join('\\n'),
  };
})()`;

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
    session.client = openCdp(url);
  }
  try {
    return await evaluate(session.client, SHELL_EXPRESSION);
  } catch (error) {
    session.client?.close();
    session.client = undefined;
    throw error;
  }
}

async function launchShell(session, port, env) {
  const binary = electronBinary();
  const args = ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${session.userDataDir}`];
  let elapsed = 0;
  session.child = await launchWithSandboxFallback({
    binary,
    args,
    env,
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
  return elapsed;
}

async function waitForShell(port, session, predicate, label) {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    last = await readShell(port, session);
    if (last && predicate(last)) {
      return last;
    }
    await sleep(30);
  }
  throw new Error(`${label} did not match within ${STEP_TIMEOUT_MS} ms: ${JSON.stringify(last)}`);
}

const SKIP_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'coverage', 'docs']);

// Chromium owns these profile folders. A real GPU rewrites GPUCache while the
// window is open. That data is not a document, a recovery copy, or a temp save.
const CHROMIUM_PROFILE_DIRECTORIES = new Set([
  'AutofillStrikeDatabase',
  'blob_storage',
  'BrowserMetrics',
  'BudgetDatabase',
  'Cache',
  'Code Cache',
  'Crashpad',
  'Crash Reports',
  'Crowd Deny',
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'databases',
  'DIPS',
  'File System',
  'GPUCache',
  'GraphiteDawnCache',
  'GrShaderCache',
  'IndexedDB',
  'Local Storage',
  'Network',
  'optimization_guide_hint_cache_store',
  'Service Worker',
  'Session Storage',
  'Sessions',
  'ShaderCache',
  'Shared Dictionary',
  'SharedStorage',
  'Site Characteristics Database',
  'Storage',
  'VideoDecodeStats',
  'WebStorage',
]);

const APP_OWNED_DIRECTORIES = new Set(['recovery', 'documents', 'temp-save']);

function isDocumentWrite(relativePath) {
  const segments = relativePath.split(/[\\/]/);
  const name = segments[segments.length - 1] ?? '';
  const lower = name.toLowerCase();
  if (lower.endsWith('.obk') || lower.endsWith('.obk.tmp') || name.includes('.~obk-')) {
    return true;
  }
  if (lower.includes('autosave')) {
    return true;
  }
  return segments.some((segment) => APP_OWNED_DIRECTORIES.has(segment.toLowerCase()));
}

async function listDocumentWrites(directory) {
  const found = [];
  async function walk(current, depth) {
    if (depth > 20) {
      return;
    }
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
      if (SKIP_DIRECTORIES.has(entry.name) || CHROMIUM_PROFILE_DIRECTORIES.has(entry.name)) {
        continue;
      }
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full, depth + 1);
      } else if (entry.isFile() && isDocumentWrite(path.relative(directory, full))) {
        found.push(path.relative(directory, full));
      }
    }
  }
  await walk(directory, 0);
  return found.sort();
}

function assertRegions(state) {
  assert.equal(state.title, 'Obelisk');
  assert.deepEqual(state.menuLabels, ['File', 'Edit', 'View', 'Insert', 'Format', 'Tools', 'Help']);
  assert.ok(state.regions.menu.top < state.regions.tabs.top, 'menu bar is above the tab strip');
  assert.ok(state.regions.tabs.top < state.regions.page.top, 'tab strip is above the page');
  assert.ok(state.regions.page.top < state.regions.status.top, 'page is above the status bar');
  assert.match(state.statusText, /Not saved/);
}

async function fileMenuState(client) {
  return evaluate(
    client,
    `(() => {
      if (document.documentElement.dataset.shellCommands !== 'ready') {
        return 'commands not ready';
      }
      const file = document.querySelector('[data-menu="file"]');
      if (!file) {
        return 'missing File menu';
      }
      if (file.getAttribute('aria-expanded') !== 'true') {
        file.click();
      }
      const item = document.querySelector('[data-region="menu-bar"] [data-command="new"]');
      if (!item || item.disabled) {
        return 'pending';
      }
      const rect = item.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return 'pending';
      }
      return 'open';
    })()`,
  );
}

async function chooseFileNew(port, session, expectedCount) {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  let menu = 'pending';
  while (Date.now() < deadline && (menu === 'pending' || menu === 'commands not ready')) {
    menu = await fileMenuState(session.client);
    if (menu === 'pending' || menu === 'commands not ready') {
      await sleep(30);
    }
  }
  if (menu !== 'open') {
    throw new Error(`File > New did not appear within ${STEP_TIMEOUT_MS} ms (${menu}).`);
  }
  const clicked = await evaluate(
    session.client,
    `(() => {
      const item = document.querySelector('[data-region="menu-bar"] [data-command="new"]');
      if (!item || item.disabled) {
        return 'missing File > New';
      }
      item.click();
      return 'clicked';
    })()`,
  );
  assert.equal(clicked, 'clicked', clicked);
  return waitForShell(
    port,
    session,
    (state) => state.tabLabels.length === expectedCount && state.activeTitle === `Untitled ${expectedCount}`,
    'File > New',
  );
}

async function replacePageText(port, session, text) {
  const result = await evaluate(
    session.client,
    `(() => {
      const editor = document.querySelector('[data-region="page-editor"]');
      const commands = editor && editor.editorCommands;
      if (!commands) {
        return 'editor commands are not ready';
      }
      commands.replaceText(${JSON.stringify(text)});
      return 'ok';
    })()`,
  );
  assert.equal(result, 'ok', result);
  return waitForShell(port, session, (state) => state.editorValue === text, `page text ${JSON.stringify(text)}`);
}

async function selectTab(port, session, tabId) {
  const title = await evaluate(
    session.client,
    `(() => {
      const tab = document.querySelector('[data-tab-id=${JSON.stringify(tabId)}]');
      if (!tab) {
        return 'missing tab';
      }
      tab.click();
      return tab.getAttribute('data-title');
    })()`,
  );
  assert.notEqual(title, 'missing tab', `missing tab ${tabId}`);
  const state = await waitForShell(
    port,
    session,
    (current) => current.activeTitle === title && current.editorValue !== undefined,
    `tab ${tabId}`,
  );
  return { active: state.activeTitle, value: state.editorValue };
}

test('launch shows the four shell regions and an editable tab within 3 seconds', { timeout: 45_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-shell-launch-'));
  const port = await freePort();
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);

  try {
    const elapsed = await launchShell(session, port);
    const state = await readShell(port, session);
    assert.ok(state, 'the shell did not render');
    console.log(`NFR-01 launch to editable tab: ${elapsed} ms`);
    assert.ok(
      elapsed < LAUNCH_LIMIT_MS,
      `NFR-01 launch to editable tab took ${elapsed} ms, limit is ${LAUNCH_LIMIT_MS} ms`,
    );
    assertRegions(state);
    assert.deepEqual(state.tabLabels, ['Untitled 1']);
    assert.equal(state.activeTitle, 'Untitled 1');
    assert.equal(state.editorValue, '');
    assert.equal(state.statusText, 'Page 1 of 1 - 0 words - 0 characters - 100% - Not saved');
    const pages = (await debuggerTargets(port)).filter((target) => target.type === 'page');
    assert.equal(pages.length, 1);
  } finally {
    await finish();
  }
});

test('File > New adds a never-saved tab and writes no file', { timeout: 45_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-shell-new-'));
  const port = await freePort();
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);

  try {
    await launchShell(session, port, { OBELISK_IPC_TRACE: '1' });
    const beforeDocuments = [
      ...(await listDocumentWrites(userDataDir)),
      ...(await listDocumentWrites(repoRoot)),
    ];
    assert.deepEqual(beforeDocuments, []);

    let state = await replacePageText(port, session, 'First page notes');
    state = await waitForShell(
      port,
      session,
      (current) => current.statusText === 'Page 1 of 1 - 3 words - 16 characters - 100% - Not saved',
      'first page status',
    );
    assert.equal(state.editorValue, 'First page notes');
    assert.equal(state.statusText, 'Page 1 of 1 - 3 words - 16 characters - 100% - Not saved');

    state = await chooseFileNew(port, session, 2);
    assert.deepEqual(state.tabLabels, ['Untitled 1', 'Untitled 2']);
    assert.equal(state.activeTitle, 'Untitled 2');
    assert.equal(state.editorValue, '');
    assert.match(state.statusText, /Not saved/);

    await replacePageText(port, session, 'Second page');
    state = await chooseFileNew(port, session, 3);
    assert.deepEqual(state.tabLabels, ['Untitled 1', 'Untitled 2', 'Untitled 3']);
    assert.equal(state.activeTitle, 'Untitled 3');
    assert.equal(state.editorValue, '');

    const firstTab = await selectTab(port, session, 'untitled-1');
    assert.equal(firstTab.active, 'Untitled 1');
    assert.equal(firstTab.value, 'First page notes');
    const secondTab = await selectTab(port, session, 'untitled-2');
    assert.equal(secondTab.active, 'Untitled 2');
    assert.equal(secondTab.value, 'Second page');

    const afterDocuments = [
      ...(await listDocumentWrites(userDataDir)),
      ...(await listDocumentWrites(repoRoot)),
    ];
    assert.deepEqual(afterDocuments, [], JSON.stringify(afterDocuments));
    assert.doesNotMatch(session.child.output, /OBELISK_IPC file:save(?:As)?(?:\s|$)/);
  } finally {
    await finish();
  }
});
