import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
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
  stopElectron,
  waitFor,
} from '../electron-launch.mjs';

const READY = `(() => {
  const region = document.querySelector('.page-region');
  const sheet = document.querySelector('.page-sheet');
  if (!region || !sheet || !sheet.editorCommands) return null;
  if (document.documentElement.dataset.shellCommands !== 'ready') return null;
  return true;
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

async function launchApp(session, port) {
  session.child = await launchWithSandboxFallback({
    binary: electronBinary(),
    args: ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${session.userDataDir}`, '--force-device-scale-factor=1'],
    ready(running) {
      return waitFor(
        running,
        async () => {
          const pages = (await debuggerTargets(port)).filter((target) => target.type === 'page');
          if (pages.length !== 1 || pages[0].title !== 'Obelisk') {
            return null;
          }
          return evaluate(await openPage(port, session), READY);
        },
        20_000,
      );
    },
  });
  return openPage(port, session);
}

async function click(client, x, y) {
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

async function clickSelector(client, selector) {
  const point = await evaluate(
    client,
    `(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return null;
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`,
  );
  assert.ok(point, `${selector} is not visible`);
  await click(client, point.x, point.y);
}

async function clickMenu(client, label) {
  const point = await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll('.menu-button')].find((node) => (node.textContent || '').trim().startsWith(${JSON.stringify(label)}));
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`,
  );
  assert.ok(point, `${label} menu is missing`);
  await click(client, point.x, point.y);
}

function readSurface(client) {
  return evaluate(
    client,
    `(() => {
      const region = document.querySelector('.page-region');
      return {
        view: region ? region.getAttribute('data-page-view') : '',
        status: (document.querySelector('[data-status-item="view"]')?.textContent || '').trim(),
        zoom: (document.querySelector('.status-zoom-value')?.textContent || '').trim(),
        frames: document.querySelectorAll('.page-frame').length,
      };
    })()`,
  );
}

async function savedPages(directory) {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  let last = '';
  while (Date.now() < deadline) {
    try {
      last = await readFile(path.join(directory, 'preferences.json'), 'utf8');
      const parsed = JSON.parse(last);
      if (parsed.view === 'pages') {
        return parsed;
      }
    } catch {
      // The file is written after the click.
    }
    await sleep(40);
  }
  assert.fail(`preferences.json did not record Pages: ${last}`);
}

test('a saved Pages or Pageless view is restored before the first paint', { timeout: 120_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-view-saved-'));
  await writeFile(
    path.join(userDataDir, 'settings.json'),
    `${JSON.stringify({ theme: 'dark', zoom: 125, view: 'pageless', spelling: false })}\n`,
  );
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);
  try {
    const client = await launchApp(session, await freePort());
    const surface = await readSurface(client);
    assert.equal(surface.view, 'pageless', JSON.stringify(surface));
    assert.equal(surface.status, 'Pageless', JSON.stringify(surface));
    assert.equal(surface.frames, 0, JSON.stringify(surface));
    assert.equal(surface.zoom, '125%', JSON.stringify(surface));
    const kept = JSON.parse(await readFile(path.join(userDataDir, 'preferences.json'), 'utf8'));
    assert.equal(kept.theme, 'dark');
    assert.equal(kept.zoom, 125);
    assert.equal(kept.view, 'pageless');
    assert.equal(kept.spelling, false);

    await clickMenu(client, 'View');
    await sleep(30);
    await clickSelector(client, '[data-item="view-pages"]');
    const pages = await waitFor(
      session.child,
      async () => {
        const next = await readSurface(client);
        return next.view === 'pages' ? next : null;
      },
      5_000,
    );
    assert.equal(pages.status, 'Pages');
    assert.ok(pages.frames >= 1, JSON.stringify(pages));
    const written = await savedPages(userDataDir);
    assert.equal(written.view, 'pages');
    assert.equal(written.zoom, 125);
    assert.equal(written.theme, 'dark');
    assert.equal(written.spelling, false);
    await stopElectron(session.child);
    session.child = undefined;
    session.client?.close();
    session.client = undefined;

    const again = { child: undefined, client: undefined, userDataDir };
    const finishAgain = bindLaunchedApp(t, again);
    try {
      const restarted = await launchApp(again, await freePort());
      const surface = await readSurface(restarted);
      const file = JSON.parse(await readFile(path.join(userDataDir, 'preferences.json'), 'utf8'));
      assert.equal(surface.view, 'pages', JSON.stringify({ surface, file }));
      assert.equal(surface.status, 'Pages', JSON.stringify({ surface, file }));
      assert.ok(surface.frames >= 1, JSON.stringify({ surface, file }));
      assert.equal(surface.zoom, '125%', JSON.stringify({ surface, file }));
    } finally {
      await finishAgain();
    }
  } finally {
    await finish();
  }

  const fallbackDir = await mkdtemp(path.join(tmpdir(), 'obelisk-view-fallback-'));
  await writeFile(path.join(fallbackDir, 'settings.json'), `${JSON.stringify({ view: 'wide', zoom: 150 })}\n`);
  const fallback = { child: undefined, client: undefined, userDataDir: fallbackDir };
  const finishFallback = bindLaunchedApp(t, fallback);
  try {
    const client = await launchApp(fallback, await freePort());
    const surface = await readSurface(client);
    assert.equal(surface.view, 'pages', JSON.stringify(surface));
    assert.equal(surface.zoom, '150%', JSON.stringify(surface));
    await sleep(200);
    const kept = JSON.parse(await readFile(path.join(fallbackDir, 'settings.json'), 'utf8'));
    assert.equal(kept.view, 'wide');
    assert.equal(kept.zoom, 150);
  } finally {
    await finishFallback();
  }
});
