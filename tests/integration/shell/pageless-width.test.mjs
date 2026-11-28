import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { decodeObk } from '../../../dist/main/codec/decode.js';
import { encodeObk } from '../../../dist/main/codec/encode/index.js';
import { emptyManifest, minimalDocument, paragraph, textRun } from '../../../scripts/make-hostile-fixtures/documents.mjs';
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
  const region = document.querySelector('.page-region');
  if (!sheet || !region || !sheet.editorCommands) return null;
  if (document.documentElement.dataset.shellCommands !== 'ready') return null;
  return true;
})()`;

const MEASURE = `(() => {
  const sheet = document.querySelector('.page-sheet');
  const region = document.querySelector('.page-region');
  if (!sheet || !region) return null;
  return {
    viewMode: region.getAttribute('data-page-view'),
    widthAttr: region.getAttribute('data-pageless-width'),
    sheetWidth: sheet.getBoundingClientRect().width,
    paddingLeft: getComputedStyle(sheet).paddingLeft,
    paddingRight: getComputedStyle(sheet).paddingRight,
    narrowChecked: document.querySelector('[data-item="view-pageless-width-narrow"]')?.getAttribute('aria-checked'),
    mediumChecked: document.querySelector('[data-item="view-pageless-width-medium"]')?.getAttribute('aria-checked'),
    unsaved: document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-unsaved'),
  };
})()`;

function near(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 2, `${label}: ${actual} expected ${expected}`);
}

async function openPage(port, session) {
  const page = (await debuggerTargets(port)).find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
  assert.ok(page, 'page DevTools socket');
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
          if (pages.length !== 1 || pages[0].title !== 'Obelisk') return null;
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

test('Pageless width choice and margin independence', { timeout: 180_000 }, async (t) => {
  const session = { child: undefined, client: undefined, userDataDir: await mkdtemp(path.join(tmpdir(), 'obelisk-pageless-width-')) };
  const finish = bindLaunchedApp(t, session);
  try {
    const port = await freePort();
    const client = await launchApp(session, port);
    await clickMenu(client, 'View');
    await sleep(50);
    await clickSelector(client, '[data-item="view-pageless"]');
    await sleep(200);
    let chrome = await evaluate(client, MEASURE);
    assert.equal(chrome.viewMode, 'pageless');
    assert.equal(chrome.widthAttr, 'medium');
    near(chrome.sheetWidth, 624, 'default medium column');
    assert.equal(chrome.paddingLeft, '0px');
    assert.equal(chrome.paddingRight, '0px');

    await clickMenu(client, 'View');
    await sleep(50);
    await clickSelector(client, '[data-item="view-pageless-width-narrow"]');
    await sleep(200);
    chrome = await evaluate(client, MEASURE);
    assert.equal(chrome.widthAttr, 'narrow');
    near(chrome.sheetWidth, 480, 'narrow column');
    assert.equal(chrome.unsaved, 'true');
    await clickMenu(client, 'View');
    await sleep(50);
    const narrowChecked = await evaluate(
      client,
      `document.querySelector('[data-item="view-pageless-width-narrow"]')?.getAttribute('aria-checked')`,
    );
    assert.equal(narrowChecked, 'true');

    await clickMenu(client, 'View');
    await sleep(50);
    await clickMenu(client, 'View');
    await sleep(50);
    await clickSelector(client, '[data-item="view-pages"]');
    await sleep(200);
    await clickMenu(client, 'Format');
    await sleep(50);
    await clickSelector(client, '[data-item="format-page-setup"]');
    await sleep(200);
    await clickSelector(client, '[data-preset="wide"]');
    await sleep(100);
    await clickSelector(client, '[data-page-ok]');
    await sleep(300);

    await clickMenu(client, 'View');
    await sleep(50);
    await clickSelector(client, '[data-item="view-pageless"]');
    await sleep(300);
    const afterMargins = await evaluate(client, MEASURE);
    assert.equal(afterMargins.widthAttr, 'narrow');
    near(afterMargins.sheetWidth, 480, 'narrow after margin change in Pages');

    const encoded = await encodeObk(
      {
        ...minimalDocument([paragraph(3, [textRun('Saved width')])]),
        view: 'pageless',
        pagelessWidth: 'narrow',
      },
      emptyManifest('0.1.53.0'),
    );
    const disk = path.join(session.userDataDir, 'disk.obk');
    assert.equal(encoded.ok, true);
    await writeFile(disk, encoded.bytes);
    const decoded = await decodeObk(disk);
    assert.equal(decoded.ok, true, decoded.ok ? '' : `${decoded.stage} ${decoded.message}`);
    assert.equal(decoded.document.pagelessWidth, 'narrow');
  } finally {
    await finish();
    await rm(session.userDataDir, { recursive: true, force: true });
  }
});