import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { decodeObk } from '../../../dist/main/codec/decode.js';
import { encodeObk } from '../../../dist/main/codec/encode/index.js';
import {
  emptyManifest,
  minimalDocument,
  paragraph,
  textRun,
} from '../../../scripts/make-hostile-fixtures/documents.mjs';
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
  const frame = document.querySelector('.page-frame');
  const sheet = document.querySelector('.page-sheet');
  const region = document.querySelector('.page-region');
  if (!frame || !sheet || !region || !sheet.editorCommands) {
    return null;
  }
  if (document.documentElement.dataset.shellCommands !== 'ready') {
    return null;
  }
  return true;
})()`;

function near(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 2, `${label}: ${actual} expected ${expected}`);
}

async function openPage(port, session) {
  const page = (await debuggerTargets(port)).find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
  assert.ok(page, 'the page has no DevTools socket');
  if (!session.client || session.client.url !== page.webSocketDebuggerUrl) {
    session.client?.close();
    session.client = openCdp(page.webSocketDebuggerUrl);
  }
  return session.client;
}

async function launchApp(session, port, extraArgs = []) {
  const binary = electronBinary();
  session.child = await launchWithSandboxFallback({
    binary,
    args: ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${session.userDataDir}`, '--force-device-scale-factor=1', ...extraArgs],
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

async function pressKey(client, key, code, virtualKey, modifiers = 0) {
  const event = {
    key,
    code,
    windowsVirtualKeyCode: virtualKey,
    nativeVirtualKeyCode: virtualKey,
    modifiers,
  };
  await client.send('Input.dispatchKeyEvent', { type: 'keyDown', ...event });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...event });
}

async function layout(client) {
  return evaluate(
    client,
    `document.querySelector('.page-sheet').editorCommands.layoutPages()`,
  );
}

async function readChrome(client) {
  return evaluate(
    client,
    `(() => {
      const region = document.querySelector('.page-region');
      const frames = [...document.querySelectorAll('.page-frame')].map((frame) => {
        const rect = frame.getBoundingClientRect();
        return {
          page: Number(frame.getAttribute('data-page')),
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          width: rect.width,
          height: rect.height,
          focus: frame.getAttribute('data-caret-focus'),
        };
      });
      const sheet = document.querySelector('.page-sheet');
      const sheetStyle = getComputedStyle(sheet);
      const lines = [];
      for (const block of sheet.querySelectorAll('p')) {
        const range = document.createRange();
        range.selectNodeContents(block);
        for (const rect of range.getClientRects()) {
          if (rect.height < 1 || rect.width < 1) continue;
          lines.push({ top: rect.top, bottom: rect.bottom, left: rect.left });
        }
      }
      const tab = document.querySelector('[role="tab"][aria-selected="true"]');
      const swatch = document.createElement('span');
      document.body.appendChild(swatch);
      swatch.style.background = 'var(--color-surface-page)';
      const pageColor = getComputedStyle(swatch).backgroundColor;
      swatch.style.background = 'var(--color-surface-pageless)';
      const pagelessColor = getComputedStyle(swatch).backgroundColor;
      swatch.remove();
      const tabColor = tab ? getComputedStyle(tab).backgroundColor : '';
      return {
        viewMode: region.getAttribute('data-page-view'),
        frames,
        lines,
        paddingTop: sheetStyle.paddingTop,
        paddingLeft: sheetStyle.paddingLeft,
        sheetWidth: sheet.getBoundingClientRect().width,
        pageLabel: (document.querySelector('[data-status-item="page"]')?.textContent || '').trim(),
        viewLabel: (() => {
          const view = document.querySelector('[data-status-item="view"]');
          if (!view || view.classList.contains('status-view-hidden')) return '';
          return (view.textContent || '').trim();
        })(),
        barWidth: document.querySelector('.status-bar')?.clientWidth || 0,
        zoom: (document.querySelector('[data-status-item="zoom"]')?.textContent || '').trim(),
        zoomButton: document.querySelector('.status-zoom')?.tagName || '',
        zoomMarks: document.querySelectorAll('.status-zoom-mark').length,
        save: (document.querySelector('[data-save-state]')?.getAttribute('data-save-state') || ''),
        unsaved: tab ? tab.getAttribute('data-unsaved') : '',
        scrollLeft: region.scrollLeft,
        regionLeft: region.getBoundingClientRect().left,
        pageColor,
        pagelessColor,
        tabColor,
        regionColor: getComputedStyle(region).backgroundColor,
      };
    })()`,
  );
}

function assertLinesInsideSheets(chrome) {
  assert.ok(chrome.frames.length > 1, `expected more than one sheet, got ${chrome.frames.length}`);
  for (const line of chrome.lines) {
    const frame = chrome.frames.find((item) => line.top >= item.top + 96 - 3 && line.bottom <= item.bottom - 96 + 3);
    assert.ok(frame, `a line is cut by a page edge ${JSON.stringify(line)} frames ${JSON.stringify(chrome.frames.map((item) => [item.top, item.bottom]))}`);
  }
}

test('Pages view flows text onto Letter sheets and Pageless switches from the View menu', { timeout: 90_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-pages-view-'));
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);

  try {
    const port = await freePort();
    const client = await launchApp(session, port);
    let chrome = await readChrome(client);
    assert.equal(chrome.viewMode, 'pages');
    assert.equal(chrome.frames.length, 1);
    near(chrome.frames[0].width, 816, 'sheet width');
    near(chrome.frames[0].height, 1056, 'sheet height');
    assert.equal(chrome.paddingTop, '96px');
    assert.equal(chrome.paddingLeft, '96px');
    near(chrome.sheetWidth, 816, 'text column');
    assert.equal(chrome.pageLabel, 'Page 1 of 1');
    assert.equal(chrome.viewLabel, 'Pages');
    assert.equal(chrome.zoom, '100%');
    assert.equal(chrome.zoomButton, 'BUTTON');
    assert.equal(chrome.zoomMarks, 0);
    assert.equal(chrome.save, 'saved');
    assert.equal(chrome.unsaved, 'false');

    await clickMenu(client, 'View');
    const checked = await evaluate(
      client,
      `(() => {
        const pages = document.querySelector('[data-item="view-pages"]');
        const pageless = document.querySelector('[data-item="view-pageless"]');
        if (!pages || !pageless) return null;
        return {
          pagesRole: pages.getAttribute('role'),
          pagelessRole: pageless.getAttribute('role'),
          pagesChecked: pages.getAttribute('aria-checked'),
          pagelessChecked: pageless.getAttribute('aria-checked'),
        };
      })()`,
    );
    assert.ok(checked, 'View menu items are missing');
    assert.equal(checked.pagesRole, 'menuitemradio');
    assert.equal(checked.pagelessRole, 'menuitemradio');
    assert.equal(checked.pagesChecked, 'true');
    assert.equal(checked.pagelessChecked, 'false');
    await clickSelector(client, '[data-item="view-pages"]');
    await sleep(50);
    chrome = await readChrome(client);
    assert.equal(chrome.save, 'saved');
    assert.equal(chrome.unsaved, 'false');
    assert.equal(chrome.viewMode, 'pages');

    await clickMenu(client, 'View');
    await clickSelector(client, '[data-item="view-pageless"]');
    await sleep(50);
    chrome = await readChrome(client);
    assert.equal(chrome.viewMode, 'pageless');
    const tabEdge = await evaluate(
      client,
      `(() => {
        const strip = document.querySelector('.tab-strip');
        const tab = document.querySelector('.tab[aria-selected="true"]');
        const region = document.querySelector('.page-region');
        return {
          overflow: getComputedStyle(strip).overflowY,
          tabBottom: tab.getBoundingClientRect().bottom,
          stripBottom: strip.getBoundingClientRect().bottom,
          regionTop: region.getBoundingClientRect().top,
        };
      })()`,
    );
    assert.equal(tabEdge.overflow, 'hidden');
    assert.ok(Math.abs(tabEdge.tabBottom - tabEdge.stripBottom) < 0.5, JSON.stringify(tabEdge));
    assert.ok(Math.abs(tabEdge.regionTop - tabEdge.stripBottom) < 0.5, JSON.stringify(tabEdge));
    assert.equal(chrome.frames.length, 0);
    assert.equal(chrome.viewLabel, 'Pageless');
    assert.equal(chrome.save, 'unsaved');
    assert.equal(chrome.unsaved, 'true');
    assert.equal(chrome.regionColor, chrome.pagelessColor);
    assert.equal(chrome.tabColor, chrome.pagelessColor);
    near(chrome.sheetWidth, 816, 'pageless column');
    assert.equal(chrome.zoom, '100%');

    await clickMenu(client, 'View');
    const pagelessCheck = await evaluate(
      client,
      `document.querySelector('[data-item="view-pageless"]')?.getAttribute('aria-checked')`,
    );
    assert.equal(pagelessCheck, 'true');
    await clickSelector(client, '[data-item="view-pages"]');
    await sleep(50);
    chrome = await readChrome(client);
    assert.equal(chrome.viewMode, 'pages');
    assert.equal(chrome.viewLabel, 'Pages');
    assert.equal(chrome.save, 'saved');
    assert.equal(chrome.frames.length, 1);

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
    chrome = await readChrome(client);
    const flowed = await layout(client);
    chrome = await readChrome(client);
    assert.ok(flowed.pageCount >= 2, JSON.stringify(flowed));
    assertLinesInsideSheets(chrome);
    assert.match(chrome.pageLabel, /^Page \d+ of \d+$/);

    await evaluate(
      client,
      `document.querySelector('.page-sheet').editorCommands.setParagraphCaret(0, 1)`,
    );
    const first = await layout(client);
    assert.equal(first.page, 1);
    assert.equal(first.label, `Page 1 of ${first.pageCount}`);
    await sleep(30);
    chrome = await readChrome(client);
    assert.equal(chrome.pageLabel, first.label);

    await evaluate(
      client,
      `(() => {
        const editor = document.querySelector('.page-sheet');
        const count = editor.editorCommands.blockSnapshot().length;
        editor.editorCommands.setParagraphCaret(count - 1, 0);
        return count;
      })()`,
    );
    const last = await layout(client);
    assert.ok(last.page > 1, JSON.stringify(last));
    await sleep(30);
    chrome = await readChrome(client);
    assert.equal(chrome.pageLabel, last.label);

    await evaluate(
      client,
      `document.querySelector('.page-sheet').editorCommands.setParagraphCaret(10, 0)`,
    );
    await evaluate(client, `document.querySelector('.page-sheet').focus()`);
    await pressKey(client, 'Enter', 'Enter', 13, 2);
    const broken = await layout(client);
    const breakPlace = await evaluate(
      client,
      `(() => {
        const blocks = [...document.querySelectorAll('.page-sheet > *')];
        const index = blocks.findIndex((node) => node.matches('.page-break'));
        const next = blocks[index + 1];
        const frames = [...document.querySelectorAll('.page-frame')].map((frame) => frame.getBoundingClientRect().top);
        if (!next) return { index, frames };
        return { index, nextTop: next.getBoundingClientRect().top, frames };
      })()`,
    );
    assert.ok(breakPlace.index >= 0, JSON.stringify(breakPlace));
    const sheetTop = breakPlace.frames.find((top) => Math.abs(breakPlace.nextTop - (top + 96)) < 8);
    assert.ok(sheetTop !== undefined, `text after the break is not at the top of a page ${JSON.stringify(breakPlace)}`);
    assert.ok(broken.pageCount >= 2);

    await evaluate(client, `document.querySelector('[role="tab"][aria-selected="true"]').focus()`);
    await pressKey(client, 'F6', 'F6', 117);
    const ring = await waitForRing(client, (state) => state.focusPage !== null && state.outline === 'solid');
    assert.equal(ring.source, 'keyboard');
    await evaluate(
      client,
      `document.querySelector('.page-sheet').editorCommands.setParagraphCaret(70, 0)`,
    );
    await layout(client);
    await evaluate(client, `document.querySelector('[role="tab"][aria-selected="true"]').focus()`);
    await pressKey(client, 'F6', 'F6', 117);
    const moved = await waitForRing(client, (state) => state.focusPage !== null && state.focusPage !== ring.focusPage);
    assert.notEqual(moved.focusPage, ring.focusPage);
    await clickSelector(client, '.page-sheet');
    const clicked = await waitForRing(client, (state) => state.focusPage === null && state.source === null);
    assert.equal(clicked.outline, 'none');

    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 640,
      height: 720,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evaluate(client, `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`);
    chrome = await readChrome(client);
    assert.equal(chrome.scrollLeft, 0);
    near(chrome.frames[0].left - chrome.regionLeft, 24, 'narrow left edge');
    assert.equal(chrome.viewLabel, '', `view label stayed at bar width ${chrome.barWidth}`);
    await client.send('Emulation.clearDeviceMetricsOverride');

    await clickMenu(client, 'View');
    await clickSelector(client, '[data-item="view-pageless"]');
    await layout(client);
    const mark = await evaluate(
      client,
      `(() => {
        const row = document.querySelector('.page-break');
        if (!row) return null;
        const style = getComputedStyle(row, '::after');
        const rule = getComputedStyle(row, '::before');
        return {
          text: row.textContent,
          label: style.content,
          border: rule.borderTopStyle,
          height: row.getBoundingClientRect().height,
          frames: document.querySelectorAll('.page-frame').length,
          labelText: (document.querySelector('[data-status-item="page"]')?.textContent || '').trim(),
        };
      })()`,
    );
    assert.ok(mark, 'pageless page break is missing');
    assert.equal(mark.frames, 0);
    assert.equal(mark.text, '');
    assert.equal(mark.label, '"Page break"');
    assert.equal(mark.border, 'dashed');
    assert.ok(mark.height > 8 && mark.height < 40, `break row ${mark.height}`);
    assert.match(mark.labelText, /^Page \d+ of \d+$/);
  } finally {
    await finish();
  }
});

async function waitForRing(client, check) {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    last = await evaluate(
      client,
      `(() => {
        const page = document.querySelector('.page-sheet');
        const frame = document.querySelector('.page-frame[data-caret-focus="true"]');
        const ring = frame || page;
        return {
          source: page.getAttribute('data-focus-source'),
          focusPage: frame ? frame.getAttribute('data-page') : null,
          outline: getComputedStyle(ring).outlineStyle,
        };
      })()`,
    );
    if (check(last)) {
      return last;
    }
    await sleep(30);
  }
  assert.fail(`ring did not settle ${JSON.stringify(last)}`);
}

test('a Pageless save opens again in Pageless', { timeout: 90_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-pages-save-'));
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);
  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-pages-file-'));
  const file = path.join(directory, 'Heat island essay.obk');

  try {
    const pagesDoc = minimalDocument([paragraph(3, [textRun('Cool roofs and street trees.')])]);
    pagesDoc.view = 'pages';
    const written = await encodeObk(pagesDoc, emptyManifest('0.1.42.0'));
    assert.equal(written.ok, true);
    await writeFile(file, written.bytes);

    const port = await freePort();
    const binary = electronBinary();
    session.child = await launchWithSandboxFallback({
      binary,
      args: ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`, '--force-device-scale-factor=1', file],
      ready(running) {
        return waitFor(
          running,
          async () => {
            const pages = (await debuggerTargets(port)).filter((target) => target.type === 'page');
            if (pages.length !== 1) {
              return null;
            }
            const client = await openPage(port, session);
            const mode = await evaluate(
              client,
              `(() => {
                const title = document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-title');
                const view = document.querySelector('.page-region')?.getAttribute('data-page-view');
                return title === 'Heat island essay.obk' && view === 'pages';
              })()`,
            );
            return mode ? true : null;
          },
          20_000,
        );
      },
    });
    const client = await openPage(port, session);
    await clickMenu(client, 'View');
    await clickSelector(client, '[data-item="view-pageless"]');
    await evaluate(
      client,
      `window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }))`,
    );
    await waitFor(
      session.child,
      async () => {
        const save = await evaluate(
          client,
          `document.querySelector('[data-save-state]')?.getAttribute('data-save-state')`,
        );
        return save === 'saved' ? true : null;
      },
      10_000,
    );
    const decoded = await decodeObk(file);
    assert.equal(decoded.ok, true, decoded.ok ? '' : `${decoded.stage} ${decoded.message}`);
    assert.equal(decoded.document.view, 'pageless');
    await finish();

    const again = { child: undefined, client: undefined, userDataDir };
    const closeAgain = bindLaunchedApp(t, again);
    try {
      const nextPort = await freePort();
      again.child = await launchWithSandboxFallback({
        binary,
        args: ['.', `--remote-debugging-port=${nextPort}`, `--user-data-dir=${userDataDir}`, '--force-device-scale-factor=1', file],
        ready(running) {
          return waitFor(
            running,
            async () => {
              const pages = (await debuggerTargets(nextPort)).filter((target) => target.type === 'page');
              if (pages.length !== 1) {
                return null;
              }
              const next = await openPage(nextPort, again);
              const mode = await evaluate(
                next,
                `(() => {
                  const region = document.querySelector('.page-region');
                  const sheet = document.querySelector('.page-sheet');
                  if (!region || !sheet || !sheet.editorCommands) return null;
                  return {
                    mode: region.getAttribute('data-page-view'),
                    frames: document.querySelectorAll('.page-frame').length,
                    view: (document.querySelector('[data-status-item="view"]')?.textContent || '').trim(),
                    text: sheet.textContent.includes('Cool roofs'),
                  };
                })()`,
              );
              return mode && mode.mode === 'pageless' ? mode : null;
            },
            20_000,
          );
        },
      });
      const next = await openPage(nextPort, again);
      const opened = await evaluate(
        next,
        `(() => ({
          mode: document.querySelector('.page-region').getAttribute('data-page-view'),
          frames: document.querySelectorAll('.page-frame').length,
          view: (document.querySelector('[data-status-item="view"]')?.textContent || '').trim(),
        }))()`,
      );
      assert.equal(opened.mode, 'pageless');
      assert.equal(opened.frames, 0);
      assert.equal(opened.view, 'Pageless');
    } finally {
      await closeAgain();
    }
  } finally {
    await finish();
  }
});

test('typing in a 50-page document stays within 50 ms', { timeout: 120_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-pages-latency-'));
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);

  try {
    const port = await freePort();
    const client = await launchApp(session, port);
    const built = await evaluate(
      client,
      `(() => {
        const line = 'Trees cool the street and the air above the pavement today.';
        const parts = [];
        for (let index = 0; index < 2800; index += 1) parts.push(line + ' ' + index);
        const editor = document.querySelector('.page-sheet');
        editor.editorCommands.replaceText(parts.join('\\n'));
        return editor.editorCommands.layoutPages();
      })()`,
    );
    assert.ok(built.pageCount >= 50, `built ${built.pageCount} pages`);
    const timed = await evaluate(
      client,
      `(() => {
        const editor = document.querySelector('.page-sheet');
        const start = performance.now();
        editor.editorCommands.insertText('Q');
        const inserted = performance.now() - start;
        const layoutStart = performance.now();
        const snap = editor.editorCommands.layoutPages();
        const layout = performance.now() - layoutStart;
        return {
          inserted,
          layout,
          shown: editor.textContent.includes('Q'),
          pages: snap.pageCount,
        };
      })()`,
    );
    assert.equal(timed.shown, true);
    assert.ok(timed.inserted < 50, `character took ${timed.inserted} ms`);
    assert.ok(timed.layout < 50, `layout took ${timed.layout} ms`);
    assert.ok(timed.pages >= 50, `pages ${timed.pages}`);
  } finally {
    await finish();
  }
});
