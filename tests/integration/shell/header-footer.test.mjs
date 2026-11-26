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
  waitFor,
} from '../electron-launch.mjs';

const READY = `(() => {
  const sheet = document.querySelector('.page-sheet');
  const band = document.querySelector('[data-page-part="header"]');
  if (!sheet || !sheet.editorCommands || !band) return null;
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
  const binary = electronBinary();
  session.child = await launchWithSandboxFallback({
    binary,
    args: ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${session.userDataDir}`, '--force-device-scale-factor=1'],
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
  return openPage(port, session);
}

async function click(client, x, y) {
  await client.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    clickCount: 1,
  });
  await client.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    clickCount: 1,
  });
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

function bandGeometry(part) {
  return `(() => {
    const sheet = document.querySelector('.page-sheet');
    const body = sheet.querySelector('p');
    const band = document.querySelector('[data-page-band-page="1"][data-page-part="${part}"]');
    const hit = band.querySelector('.page-band-hit');
    const frame = document.querySelector('.page-frame[data-page="1"]');
    const origin = frame.getBoundingClientRect().top;
    const box = (node) => {
      const rect = node.getBoundingClientRect();
      return { top: rect.top - origin, bottom: rect.bottom - origin };
    };
    return {
      pad: getComputedStyle(sheet).paddingTop,
      bodyTop: box(body).top,
      bandTop: box(band).top,
      bandBottom: box(band).bottom,
      hitTop: box(hit).top,
      hitBottom: box(hit).bottom,
    };
  })()`;
}

function sameGeometry(before, after, label) {
  assert.equal(before.pad, after.pad, `${label} padding`);
  for (const key of ['bodyTop', 'bandTop', 'bandBottom', 'hitTop', 'hitBottom']) {
    assert.ok(Math.abs(before[key] - after[key]) < 0.5, `${label} ${key} moved from ${before[key]} to ${after[key]}`);
  }
}

async function headerTexts(client) {
  return evaluate(
    client,
    `(() => {
      const headers = [...document.querySelectorAll('[data-page-part="header"] .page-band-text')].map((node) => (node.textContent || '').replace(/\\s+/g, ' ').trim());
      const editing = document.querySelector('[data-header-editor="true"]') !== null;
      const bands = document.querySelectorAll('.page-band').length;
      const opacity = getComputedStyle(document.querySelector('.editor-host')).opacity;
      const unsaved = document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-unsaved') || '';
      return { headers, editing, bands, opacity, unsaved, view: document.querySelector('.page-region')?.getAttribute('data-page-view') || '' };
    })()`,
  );
}

test('the same header is on every page and each page shows its own number', { timeout: 90_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-header-'));
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);

  try {
    const port = await freePort();
    const client = await launchApp(session, port);
    await evaluate(
      client,
      `(() => {
        const line = 'Cool roofs and street trees lower the heat on a long city block.';
        const parts = [];
        for (let index = 0; index < 80; index += 1) parts.push(line);
        document.querySelector('.page-sheet').editorCommands.replaceText(parts.join('\\n'));
        return true;
      })()`,
    );
    const flowed = await evaluate(client, `document.querySelector('.page-sheet').editorCommands.layoutPages()`);
    assert.ok(flowed.pageCount >= 2, JSON.stringify(flowed));
    await evaluate(client, `document.querySelector('.page-region').scrollTop = 0`);
    await sleep(50);
    const headerBefore = await evaluate(client, bandGeometry('header'));

    await clickSelector(client, '[data-page-band-page="1"][data-page-part="header"] .page-band-hit');
    await waitFor(
      session.child,
      async () => evaluate(client, `document.querySelector('[data-header-editor="true"]') ? true : null`),
      5_000,
    );
    const bubble = await evaluate(
      client,
      `(() => {
        const band = document.querySelector('[data-page-band-page="1"][data-page-part="header"]');
        const hit = band.querySelector('.page-band-hit');
        const tools = band.querySelector('[data-page-band-bubble]');
        const sheet = getComputedStyle(document.querySelector('.page-sheet'));
        const bandRect = band.getBoundingClientRect();
        const hitRect = hit.getBoundingClientRect();
        const toolsRect = tools.getBoundingClientRect();
        const toolsStyle = getComputedStyle(tools);
        return {
          paddingTop: sheet.paddingTop,
          position: toolsStyle.position,
          above: toolsRect.bottom <= hitRect.top + 1,
          centered: Math.abs((toolsRect.left + toolsRect.right) / 2 - (bandRect.left + bandRect.right) / 2) < 2,
        };
      })()`,
    );
    assert.equal(bubble.paddingTop, '96px', JSON.stringify(bubble));
    assert.equal(bubble.position, 'absolute', JSON.stringify(bubble));
    assert.equal(bubble.above, true, JSON.stringify(bubble));
    assert.equal(bubble.centered, true, JSON.stringify(bubble));
    sameGeometry(headerBefore, await evaluate(client, bandGeometry('header')), 'header open');
    await client.send('Input.insertText', { text: 'Plong ' });
    await sleep(80);
    await clickSelector(client, '[data-insert-page-number]');
    await sleep(30);
    await clickSelector(client, '[data-field-format="decimal"]');
    await sleep(80);

    let read = await headerTexts(client);
    assert.equal(read.editing, true);
    assert.equal(read.opacity, '0.45');
    assert.equal(read.unsaved, 'true');
    assert.ok(read.headers.length >= 2, JSON.stringify(read.headers));
    assert.equal(read.headers[0], 'Plong 1');
    assert.equal(read.headers[1], 'Plong 2');

    const headerOpen = await evaluate(client, bandGeometry('header'));
    await clickSelector(client, '[data-insert-close]');
    await sleep(50);
    sameGeometry(headerOpen, await evaluate(client, bandGeometry('header')), 'header closed');
    read = await headerTexts(client);
    assert.equal(read.editing, false);
    assert.equal(read.headers[0], 'Plong 1');
    assert.equal(read.headers[1], 'Plong 2');

    await evaluate(
      client,
      `document.querySelector('[data-page-band-page="1"][data-page-part="footer"]').scrollIntoView({ block: 'center' })`,
    );
    await sleep(40);
    const footerBefore = await evaluate(client, bandGeometry('footer'));
    await clickSelector(client, '[data-page-band-page="1"][data-page-part="footer"] .page-band-hit');
    await waitFor(
      session.child,
      async () => evaluate(client, `document.querySelector('[data-header-editor="true"]') ? true : null`),
      5_000,
    );
    const footerBubble = await evaluate(
      client,
      `(() => {
        const band = document.querySelector('[data-page-band-page="1"][data-page-part="footer"]');
        const hit = band.querySelector('.page-band-hit');
        const tools = band.querySelector('[data-page-band-bubble]');
        const hitRect = hit.getBoundingClientRect();
        const toolsRect = tools.getBoundingClientRect();
        return { above: toolsRect.bottom <= hitRect.top + 1 };
      })()`,
    );
    assert.equal(footerBubble.above, true, JSON.stringify(footerBubble));
    sameGeometry(footerBefore, await evaluate(client, bandGeometry('footer')), 'footer open');
    await clickSelector(client, '[data-insert-close]');
    await sleep(40);
    sameGeometry(footerBefore, await evaluate(client, bandGeometry('footer')), 'footer closed');

    await clickMenu(client, 'View');
    await sleep(30);
    await clickSelector(client, '[data-item="view-pageless"]');
    await sleep(50);
    read = await headerTexts(client);
    assert.equal(read.view, 'pageless');
    assert.equal(read.bands, 0);
    await clickMenu(client, 'Format');
    await sleep(30);
    const disabled = await evaluate(
      client,
      `document.querySelector('[data-item="format-header"]')?.getAttribute('aria-disabled')`,
    );
    assert.equal(disabled, 'true');
  } finally {
    await finish();
  }
});
