import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { decodeObk } from '../../../dist/main/codec/decode.js';
import { encodeObk } from '../../../dist/main/codec/encode/index.js';
import { emptyManifest, minimalDocument, paragraph, textRun } from '../../../scripts/make-hostile-fixtures/documents.mjs';
import {
  bindLaunchedApp,
  closeElectron,
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

// H-31. The same characters are stored in the file and typed into the page.
const STORED = [
  '# Title **markdown** [link](https://evil.example/md)',
  '<script>alert(1)</script><img src="https://evil.example/pixel.png">',
  '<img src="https://evil.example/pixel.png" onerror="alert(1)">',
  '<b>tag</b><iframe src="https://evil.example/frame"></iframe>',
].join(' ');

const TYPED = ' <img src="https://evil.example/typed.png" onerror="alert(2)"><script>alert(2)</script> [typed](https://evil.example/typed)';

const FILE_NAME = 'markup-notes.obk';

const FORBIDDEN_TAGS = new Set([
  'A', 'B', 'CODE', 'EM', 'EMBED', 'FORM', 'FRAME', 'FRAMESET', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'I', 'IFRAME', 'IMG', 'INPUT', 'LINK', 'MATH', 'META', 'OBJECT', 'S', 'SCRIPT', 'SOURCE', 'STRONG',
  'STYLE', 'SVG', 'VIDEO', 'AUDIO', 'BUTTON', 'BASE',
]);

const INSTALL_WATCH = `(() => {
  if (window.__obeliskMarkupWatch) {
    return 'ready';
  }
  const seen = [];
  window.__obeliskMarkupWatch = seen;
  window.__obeliskMarkupAlerts = [];
  const note = (url) => { seen.push(String(url)); };
  const fetchImpl = window.fetch.bind(window);
  window.fetch = (input, init) => {
    note(typeof input === 'string' ? input : (input && input.url) || '');
    return fetchImpl(input, init);
  };
  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function openRequest(method, url) {
    note(url);
    return open.call(this, method, url);
  };
  const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  if (src && src.set && src.get) {
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      configurable: true,
      enumerable: src.enumerable,
      get() { return src.get.call(this); },
      set(value) { note(value); src.set.call(this, value); },
    });
  }
  window.alert = (message) => { window.__obeliskMarkupAlerts.push(String(message)); };
  return 'ready';
})()`;

const READ_SURFACE = `(() => {
  const editor = document.querySelector('[data-region="page-editor"]');
  const commands = editor && editor.editorCommands;
  if (!editor || !commands || typeof commands.blockSnapshot !== 'function') {
    return null;
  }
  let snapshot;
  try {
    snapshot = commands.blockSnapshot();
  } catch {
    return null;
  }
  const html = editor.innerHTML;
  const tags = [...editor.querySelectorAll('*')].map((el) => el.tagName);
  const handlers = [];
  for (const el of editor.querySelectorAll('*')) {
    for (const attr of [...el.attributes]) {
      if (attr.name.toLowerCase().startsWith('on')) {
        handlers.push(attr.name);
      }
    }
  }
  const tab = document.querySelector('[role="tab"][data-title]');
  const save = document.querySelector('[data-status-item="save"]');
  return {
    snapshot,
    text: editor.textContent,
    escapedScript: html.includes('&lt;script'),
    escapedImg: html.includes('&lt;img'),
    rawScript: html.includes('<script'),
    rawImg: html.toLowerCase().includes('<img'),
    rawFrame: html.toLowerCase().includes('<iframe'),
    tags,
    handlers,
    alerts: window.__obeliskMarkupAlerts || [],
    watched: window.__obeliskMarkupWatch || [],
    resources: performance.getEntriesByType('resource').map((entry) => entry.name),
    title: tab ? tab.getAttribute('data-title') : '',
    saveState: save ? save.getAttribute('data-save-state') : '',
    notice: (document.querySelector('[data-open-notice]')?.textContent || '').trim(),
  };
})()`;

function httpUrls(surface, output, events) {
  const found = [...(surface.watched || []), ...(surface.resources || [])];
  for (const event of events) {
    if (event.method === 'Network.requestWillBeSent') {
      found.push(event.params?.request?.url ?? '');
    }
  }
  for (const match of output.matchAll(/OBELISK_REQUEST_BLOCKED (\S+)/g)) {
    found.push(match[1]);
  }
  return found.filter((url) => /^https?:/i.test(String(url)));
}

function assertLiteral(surface, expected) {
  assert.ok(surface, 'the page did not show the document');
  assert.equal(surface.title, FILE_NAME);
  assert.equal(surface.snapshot.length, 1, JSON.stringify(surface.snapshot));
  assert.equal(surface.snapshot[0].type, 'paragraph', JSON.stringify(surface.snapshot));
  assert.equal(surface.snapshot[0].text, expected, JSON.stringify(surface.snapshot));
  assert.equal(surface.text, expected);
  assert.equal(surface.rawScript, false, surface.tags.join(','));
  assert.equal(surface.rawImg, false, surface.tags.join(','));
  assert.equal(surface.rawFrame, false, surface.tags.join(','));
  assert.equal(surface.escapedScript, true);
  assert.equal(surface.escapedImg, true);
  assert.deepEqual(surface.tags.filter((tag) => FORBIDDEN_TAGS.has(tag)), [], surface.tags.join(','));
  assert.deepEqual(surface.handlers, []);
  assert.deepEqual(surface.alerts, []);
}

function assertNoRequest(surface, output, events) {
  assert.deepEqual(httpUrls(surface, output, events), [], `${output}\n${JSON.stringify(surface.watched)}`);
}

async function fingerprint(file) {
  const bytes = await readFile(file);
  const info = await stat(file);
  return {
    size: info.size,
    mtimeMs: info.mtimeMs,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function paragraphText(document) {
  assert.equal(document.blocks.length, 1);
  const block = document.blocks[0];
  assert.equal(block.type, 'paragraph', JSON.stringify(block));
  assert.ok(Array.isArray(block.content));
  let text = '';
  for (const part of block.content) {
    assert.equal(part.type, 'text', JSON.stringify(part));
    assert.equal(Object.hasOwn(part, 'marks'), false, JSON.stringify(part));
    text += part.text;
  }
  return text;
}

async function pageTarget(port) {
  const pages = (await debuggerTargets(port)).filter(
    (target) => target.type === 'page' && typeof target.webSocketDebuggerUrl === 'string',
  );
  if (pages.length !== 1) {
    return null;
  }
  return pages[0].webSocketDebuggerUrl;
}

async function launchDocument(session, port, file, expected) {
  let opened = null;
  session.child = await launchWithSandboxFallback({
    binary: electronBinary(),
    args: ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${session.userDataDir}`, file],
    env: { OBELISK_SECURITY_REPORT: '1' },
    ready(running) {
      return waitFor(
        running,
        async () => {
          try {
            if (!session.client) {
              const url = await pageTarget(port);
              if (!url) {
                return null;
              }
              session.client = openCdp(url);
              await session.client.send('Network.enable');
              await evaluate(session.client, INSTALL_WATCH);
            }
            const surface = await evaluate(session.client, READ_SURFACE);
            if (!surface || surface.snapshot?.[0]?.text !== expected || surface.title !== FILE_NAME) {
              return null;
            }
            opened = surface;
            return surface;
          } catch (error) {
            session.client?.close();
            session.client = undefined;
            throw error;
          }
        },
        20_000,
      );
    },
  });
  return opened;
}

async function typeMarkup(session, typed) {
  const before = await evaluate(session.client, `(() => {
    const editor = document.querySelector('[data-region="page-editor"]');
    const commands = editor && editor.editorCommands;
    if (!commands) {
      return null;
    }
    editor.focus();
    return commands.blockSnapshot()[0].text;
  })()`);
  assert.equal(before, STORED);
  // A real text input, not an HTML paste. The caret may be at either edge.
  await session.client.send('Input.insertText', { text: typed });
  const deadline = Date.now() + 2_000;
  let probe = null;
  while (Date.now() < deadline) {
    const surface = await evaluate(session.client, READ_SURFACE);
    const text = surface?.snapshot?.[0]?.text;
    if (typeof text === 'string' && text.includes(typed) && text.includes(before)) {
      probe = surface;
      break;
    }
    await sleep(30);
  }
  assert.ok(probe, 'typed markup was not inserted as text');
  assertLiteral(probe, probe.snapshot[0].text);

  const expected = before + typed;
  const typedText = await evaluate(session.client, `(() => {
    const editor = document.querySelector('[data-region="page-editor"]');
    const commands = editor.editorCommands;
    commands.replaceText(${JSON.stringify(before)});
    commands.setParagraphCaret(0, ${JSON.stringify(before)}.length);
    commands.insertText(${JSON.stringify(typed)});
    return commands.blockSnapshot()[0].text;
  })()`);
  assert.equal(typedText, expected);
  return evaluate(session.client, READ_SURFACE);
}

async function waitForSaveState(client, state) {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  let last = '';
  while (Date.now() < deadline) {
    const surface = await evaluate(client, READ_SURFACE);
    last = JSON.stringify({ state: surface?.saveState, notice: surface?.notice });
    if (surface?.saveState === state) {
      return;
    }
    if (surface?.saveState === 'not-saved' || surface?.notice) {
      throw new Error(`Save failed: ${last}`);
    }
    await sleep(30);
  }
  throw new Error(`Save state did not become ${state}: ${last}`);
}

async function saveDocument(client) {
  await waitForSaveState(client, 'unsaved');
  await evaluate(
    client,
    `window.dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify({
      key: 's',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })}))`,
  );
  await waitForSaveState(client, 'saved');
}

test('H-31 markup text is stored, typed, saved, and reopened as text', { timeout: 120_000 }, async (t) => {
  const docDir = await mkdtemp(path.join(tmpdir(), 'obelisk-markup-'));
  const file = path.join(docDir, FILE_NAME);
  const pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  const encoded = await encodeObk(
    minimalDocument([paragraph(3, [textRun(STORED)])]),
    emptyManifest(pkg.version),
  );
  assert.equal(encoded.ok, true, JSON.stringify(encoded));
  await writeFile(file, encoded.bytes);
  const openedBytes = await fingerprint(file);

  const session = {
    child: undefined,
    client: undefined,
    userDataDir: await mkdtemp(path.join(tmpdir(), 'obelisk-markup-data-')),
  };
  const finish = bindLaunchedApp(t, session);

  try {
    const port = await freePort();
    const opened = await launchDocument(session, port, file, STORED);
    assertLiteral(opened, STORED);
    assert.equal(opened.saveState, 'saved');
    await sleep(400);
    const settled = await evaluate(session.client, READ_SURFACE);
    assertLiteral(settled, STORED);
    assertNoRequest(settled, session.child.output ?? '', session.client.events);
    assert.deepEqual(await fingerprint(file), openedBytes);

    const typed = await typeMarkup(session, TYPED);
    const savedText = STORED + TYPED;
    assertLiteral(typed, savedText);
    await saveDocument(session.client);
    const written = await fingerprint(file);
    assert.notEqual(written.sha256, openedBytes.sha256);
    const decoded = await decodeObk(file);
    assert.equal(decoded.ok, true, JSON.stringify(decoded));
    assert.equal(paragraphText(decoded.document), savedText);

    const previousChild = session.child;
    const previousData = session.userDataDir;
    session.client?.close();
    session.client = undefined;
    session.child = undefined;
    await closeElectron(previousChild, previousData);
    session.userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-markup-data-'));
    const againPort = await freePort();
    const reopened = await launchDocument(session, againPort, file, savedText);
    assertLiteral(reopened, savedText);
    await sleep(400);
    const reopenedSettled = await evaluate(session.client, READ_SURFACE);
    assertLiteral(reopenedSettled, savedText);
    assertNoRequest(reopenedSettled, session.child.output ?? '', session.client.events);
    assert.deepEqual(await fingerprint(file), written);
  } finally {
    await finish();
    await rm(docDir, { recursive: true, force: true });
  }
});
