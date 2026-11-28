import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inflateSync } from 'node:zlib';
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
  if (document.documentElement.dataset.shellCommands !== 'ready') return null;
  if (document.querySelector('[data-page="start"]') && !document.querySelector('[data-region="page-editor"]')) {
    document.querySelector('.start-action-primary')?.click();
  }
  return document.querySelector('.tab[aria-selected="true"]') ? true : null;
})()`;

const LAYOUT = `(() => {
  const strip = document.querySelector('.tab-strip');
  const selected = document.querySelector('.tab[aria-selected="true"]');
  const idle = document.querySelector('.tab:not([aria-selected="true"])');
  const region = document.querySelector('.page-region');
  const selectedBox = selected.getBoundingClientRect();
  const idleBox = idle ? idle.getBoundingClientRect() : null;
  const selectedStyle = getComputedStyle(selected);
  return {
    dpr: window.devicePixelRatio,
    innerWidth: window.innerWidth,
    theme: document.documentElement.getAttribute('data-theme'),
    view: region.getAttribute('data-page-view'),
    focused: selected.matches(':focus-visible'),
    stripBottom: strip.getBoundingClientRect().bottom,
    stripShadow: getComputedStyle(strip).boxShadow,
    tabBottom: selectedBox.bottom,
    radius: selectedStyle.borderRadius,
    borderBottom: selectedStyle.borderBottomWidth,
    clip: selectedStyle.clipPath,
    shadow: selectedStyle.boxShadow,
    selected: { left: selectedBox.left, right: selectedBox.right },
    idle: idleBox ? { left: idleBox.left, right: idleBox.right } : null,
  };
})()`;

function decodePng(buffer) {
  const data = Buffer.from(buffer);
  assert.equal(data.toString('ascii', 1, 4), 'PNG');
  let pos = 8;
  let width = 0;
  let height = 0;
  let color = 0;
  let interlace = 0;
  const idat = [];
  while (pos < data.length) {
    const length = data.readUInt32BE(pos);
    const type = data.toString('ascii', pos + 4, pos + 8);
    const chunk = data.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      color = chunk[9];
      interlace = chunk[10];
    } else if (type === 'IDAT') {
      idat.push(chunk);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + length;
  }
  assert.equal(interlace, 0);
  assert.ok(color === 2 || color === 6);
  const bpp = color === 6 ? 4 : 3;
  const inflated = inflateSync(Buffer.concat(idat));
  const rows = [];
  let previous = Buffer.alloc(width * bpp);
  let index = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[index];
    index += 1;
    const row = Buffer.from(inflated.subarray(index, index + width * bpp));
    index += width * bpp;
    const left = (x) => (x >= bpp ? row[x - bpp] : 0);
    const up = (x) => previous[x];
    const upLeft = (x) => (x >= bpp ? previous[x - bpp] : 0);
    if (filter === 1) {
      for (let x = 0; x < row.length; x += 1) row[x] = (row[x] + left(x)) & 255;
    } else if (filter === 2) {
      for (let x = 0; x < row.length; x += 1) row[x] = (row[x] + up(x)) & 255;
    } else if (filter === 3) {
      for (let x = 0; x < row.length; x += 1) row[x] = (row[x] + ((left(x) + up(x)) >> 1)) & 255;
    } else if (filter === 4) {
      for (let x = 0; x < row.length; x += 1) {
        const a = left(x);
        const b = up(x);
        const c = upLeft(x);
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        row[x] = (row[x] + predictor) & 255;
      }
    } else {
      assert.equal(filter, 0);
    }
    previous = row;
    rows.push(row);
  }
  return { width, height, bpp, rows };
}

function pixel(img, x, y) {
  assert.ok(x >= 0 && y >= 0 && x < img.width && y < img.height, `pixel ${x},${y} is outside ${img.width}x${img.height}`);
  const offset = x * img.bpp;
  const row = img.rows[y];
  return [row[offset], row[offset + 1], row[offset + 2]];
}

const RGB_TOLERANCE = 6;

function closeRgb(left, right, tolerance = RGB_TOLERANCE) {
  return (
    Math.abs(left[0] - right[0]) <= tolerance &&
    Math.abs(left[1] - right[1]) <= tolerance &&
    Math.abs(left[2] - right[2]) <= tolerance
  );
}

function deviceX(css, scale) {
  return Math.round(css * scale);
}

function fillSpan(img, y, fill, box, scale) {
  const from = deviceX(box.left, scale) - 6;
  const to = deviceX(box.right, scale) + 6;
  let left = -1;
  let right = -1;
  for (let x = from; x <= to; x += 1) {
    if (closeRgb(pixel(img, x, y), fill)) {
      if (left < 0) left = x;
      right = x;
    }
  }
  assert.ok(left >= 0, `tab fill ${fill} was not found on row ${y}`);
  for (let x = left; x <= right; x += 1) {
    const got = pixel(img, x, y);
    assert.ok(closeRgb(got, fill), `row ${y} pixel ${x} is ${got}, tab fill is ${fill}`);
  }
  return { left, right };
}

// The strip's old bottom hairline was a lighter row beside the tab, and at 125%
// it also blended into the row above. The tab must meet the page with square
// bottom corners and no extra color on or below that edge.
function assertActiveEdge(img, layout, label) {
  const scale = img.width / layout.innerWidth;
  const yEdge = deviceX(layout.stripBottom, scale);
  const box = layout.selected;
  const xMid = deviceX((box.left + box.right) / 2, scale);
  const chromeX = deviceX(3, scale);
  const fill = pixel(img, xMid, yEdge - 4);
  const chrome = pixel(img, chromeX, yEdge - 6);
  const page = pixel(img, chromeX, yEdge + 6);
  assert.ok(!closeRgb(fill, chrome), `${label} tab fill ${fill} matches the strip ${chrome}`);
  assert.ok(closeRgb(pixel(img, xMid, yEdge - 1), fill), `${label} tab bottom ${pixel(img, xMid, yEdge - 1)} is not ${fill}`);
  const above = fillSpan(img, yEdge - 4, fill, box, scale);
  const last = fillSpan(img, yEdge - 1, fill, box, scale);
  assert.deepEqual(last, above, `${label} bottom corners are rounded`);
  assert.ok(
    closeRgb(pixel(img, above.left - 2, yEdge - 2), chrome),
    `${label} left of the tab is ${pixel(img, above.left - 2, yEdge - 2)}, strip is ${chrome}`,
  );
  assert.ok(
    closeRgb(pixel(img, above.right + 2, yEdge - 2), chrome),
    `${label} right of the tab is ${pixel(img, above.right + 2, yEdge - 2)}, strip is ${chrome}`,
  );
  for (let y = yEdge; y < yEdge + 4; y += 1) {
    for (let x = above.left - 3; x <= above.right + 3; x += 1) {
      const got = pixel(img, x, y);
      assert.ok(closeRgb(got, page), `${label} below the strip at ${x},${y} is ${got}, page is ${page}`);
    }
  }
}

function assertIdleEdge(img, layout, label) {
  const scale = img.width / layout.innerWidth;
  const yEdge = deviceX(layout.stripBottom, scale);
  const box = layout.idle;
  const xMid = deviceX((box.left + box.right) / 2, scale);
  const chromeX = deviceX(3, scale);
  const chrome = pixel(img, chromeX, yEdge - 6);
  const page = pixel(img, chromeX, yEdge + 6);
  assert.ok(closeRgb(pixel(img, xMid, yEdge - 1), chrome), `${label} inactive bottom ${pixel(img, xMid, yEdge - 1)} is not the strip ${chrome}`);
  assert.ok(closeRgb(pixel(img, xMid, yEdge - 2), chrome), `${label} inactive hairline ${pixel(img, xMid, yEdge - 2)}`);
  const left = deviceX(box.left, scale);
  const right = deviceX(box.right, scale) - 1;
  for (let y = yEdge; y < yEdge + 4; y += 1) {
    for (let x = left - 2; x <= right + 2; x += 1) {
      const got = pixel(img, x, y);
      assert.ok(closeRgb(got, page), `${label} below an inactive tab at ${x},${y} is ${got}, page is ${page}`);
    }
  }
}

function assertFocusedEdge(img, layout, label) {
  const scale = img.width / layout.innerWidth;
  const yEdge = deviceX(layout.stripBottom, scale);
  const box = layout.selected;
  const chromeX = deviceX(3, scale);
  const page = pixel(img, chromeX, yEdge + 6);
  const left = deviceX(box.left, scale);
  const right = deviceX(box.right, scale) - 1;
  for (let y = yEdge; y < yEdge + 4; y += 1) {
    for (let x = left - 3; x <= right + 3; x += 1) {
      const got = pixel(img, x, y);
      assert.ok(closeRgb(got, page), `${label} focus ring at ${x},${y} is ${got}, page is ${page}`);
    }
  }
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

async function launchApp(session, port, scale) {
  session.child = await launchWithSandboxFallback({
    binary: electronBinary(),
    args: ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${session.userDataDir}`, `--force-device-scale-factor=${scale}`],
    ready(running) {
      return waitFor(running, async () => {
        const pages = (await debuggerTargets(port)).filter((target) => target.type === 'page');
        if (pages.length !== 1) return null;
        return evaluate(await openPage(port, session), READY);
      }, 20_000);
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

async function showView(client, view) {
  const current = await evaluate(client, `document.querySelector('.page-region').getAttribute('data-page-view')`);
  if (current === view) return;
  const point = await evaluate(
    client,
    `(() => {
      const button = [...document.querySelectorAll('.menu-button')].find((node) => (node.textContent || '').trim().startsWith('View'));
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`,
  );
  assert.ok(point, 'View menu is missing');
  await click(client, point.x, point.y);
  await sleep(50);
  await clickSelector(client, `[data-item="view-${view}"]`);
  await sleep(50);
}

async function shot(client) {
  const captured = await client.send('Page.captureScreenshot', { format: 'png' });
  return decodePng(Buffer.from(captured.data, 'base64'));
}

test('the active tab meets the page at 100% and 125% in both themes and views', { timeout: 120_000 }, async (t) => {
  for (const scale of ['1', '1.25']) {
    const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-tab-edge-'));
    await writeFile(path.join(userDataDir, 'settings.json'), JSON.stringify({ theme: 'dark', view: 'pageless' }));
    const session = { child: undefined, client: undefined, userDataDir };
    const finish = bindLaunchedApp(t, session);
    const port = await freePort();
    const client = await launchApp(session, port, scale);
    try {
      for (const theme of ['dark', 'light']) {
        await evaluate(client, `document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)})`);
        await sleep(50);
        for (const view of ['pageless', 'pages']) {
          await showView(client, view);
          const layout = await evaluate(client, LAYOUT);
          assert.equal(layout.theme, theme);
          assert.equal(layout.view, view);
          assert.equal(layout.dpr, Number(scale));
          assert.equal(layout.stripShadow, 'none');
          assert.equal(layout.borderBottom, '0px');
          assert.equal(layout.radius, '6px 6px 0px 0px');
          assert.equal(layout.clip, 'inset(0px)');
          assert.equal(layout.focused, false);
          assert.ok(Math.abs(layout.tabBottom - layout.stripBottom) < 0.5);
          const img = await shot(client);
          assert.ok(Math.abs(img.width / layout.innerWidth - layout.dpr) < 0.02, `${img.width} / ${layout.innerWidth}`);
          assertActiveEdge(img, layout, `${scale} ${theme} ${view}`);

          await evaluate(client, `document.querySelector('.tab[aria-selected="true"]').focus({ focusVisible: true })`);
          await sleep(30);
          const focused = await evaluate(client, LAYOUT);
          assert.equal(focused.focused, true, `${scale} ${theme} ${view} tab did not show the focus ring`);
          assertFocusedEdge(await shot(client), focused, `${scale} ${theme} ${view} focused`);
          await evaluate(client, `document.querySelector('.page-sheet').focus()`);
          await sleep(30);
        }
      }
      await showView(client, 'pageless');
      await clickSelector(client, '.tab-new');
      await sleep(50);
      for (const theme of ['dark', 'light']) {
        await evaluate(client, `document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)})`);
        await sleep(50);
        const layout = await evaluate(client, LAYOUT);
        assert.equal(layout.view, 'pageless');
        assert.ok(layout.idle, 'the inactive tab is missing');
        assertIdleEdge(await shot(client), layout, `${scale} ${theme} inactive`);
      }
    } finally {
      await finish();
    }
  }
});
