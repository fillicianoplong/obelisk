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

const READ = `(() => {
  const menu = document.querySelector('.menu-bar');
  const status = document.querySelector('.status-bar');
  const region = document.querySelector('.page-region');
  const tab = document.querySelector('.tab[aria-selected="true"]');
  const menuStyle = getComputedStyle(menu);
  const statusStyle = getComputedStyle(status);
  const bar = getComputedStyle(region, '::-webkit-scrollbar');
  const button = getComputedStyle(region, '::-webkit-scrollbar-button');
  const thumb = getComputedStyle(region, '::-webkit-scrollbar-thumb');
  const track = getComputedStyle(region, '::-webkit-scrollbar-track');
  const menuBox = menu.getBoundingClientRect();
  const statusBox = status.getBoundingClientRect();
  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    dpr: window.devicePixelRatio,
    view: region.getAttribute('data-page-view'),
    menuBottom: menuStyle.borderBottomWidth,
    menuColor: menuStyle.borderBottomColor,
    menuLeft: menuBox.left,
    menuRight: menuBox.right,
    menuEdge: menuBox.bottom,
    statusTop: statusStyle.borderTopWidth,
    statusColor: statusStyle.borderTopColor,
    statusLeft: statusBox.left,
    statusRight: statusBox.right,
    statusEdge: statusBox.top,
    barWidth: bar.width,
    barHeight: bar.height,
    buttonWidth: button.width,
    buttonHeight: button.height,
    thumbRadius: thumb.borderRadius,
    thumbBorder: thumb.borderTopWidth,
    thumbBorderColor: thumb.borderTopColor,
    trackColor: track.backgroundColor,
    tabColor: getComputedStyle(tab).backgroundColor,
    regionColor: getComputedStyle(region).backgroundColor,
    overflowY: region.scrollHeight > region.clientHeight,
  };
})()`;

function decodePng(buffer) {
  const data = Buffer.from(buffer);
  let pos = 8;
  let width = 0;
  let height = 0;
  let color = 0;
  const idat = [];
  while (pos < data.length) {
    const length = data.readUInt32BE(pos);
    const type = data.toString('ascii', pos + 4, pos + 8);
    const chunk = data.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      color = chunk[9];
    } else if (type === 'IDAT') idat.push(chunk);
    else if (type === 'IEND') break;
    pos += 12 + length;
  }
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
    if (filter === 1) for (let x = 0; x < row.length; x += 1) row[x] = (row[x] + left(x)) & 255;
    else if (filter === 2) for (let x = 0; x < row.length; x += 1) row[x] = (row[x] + up(x)) & 255;
    else if (filter === 3) for (let x = 0; x < row.length; x += 1) row[x] = (row[x] + ((left(x) + up(x)) >> 1)) & 255;
    else if (filter === 4) {
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
    }
    previous = row;
    rows.push(row);
  }
  return { width, height, bpp, rows };
}

function pixel(img, x, y) {
  const offset = x * img.bpp;
  const row = img.rows[y];
  return [row[offset], row[offset + 1], row[offset + 2]];
}

function same(left, right) {
  return left[0] === right[0] && left[1] === right[1] && left[2] === right[2];
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

test('shell hairlines run the full width and the scrollbar thumb is slim', { timeout: 60_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-shell-frame-'));
  await writeFile(path.join(userDataDir, 'settings.json'), JSON.stringify({ theme: 'light', view: 'pages' }));
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);
  const port = await freePort();
  session.child = await launchWithSandboxFallback({
    binary: electronBinary(),
    args: ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`, '--force-device-scale-factor=1'],
    ready(running) {
      return waitFor(running, async () => {
        const pages = (await debuggerTargets(port)).filter((target) => target.type === 'page');
        if (pages.length !== 1) return null;
        return evaluate(await openPage(port, session), READY);
      }, 20_000);
    },
  });
  const client = await openPage(port, session);
  try {
    const frame = await evaluate(client, READ);
    assert.equal(frame.menuBottom, '1px');
    assert.equal(frame.statusTop, '1px');
    assert.equal(frame.menuColor, frame.statusColor);
    assert.equal(frame.menuLeft, 0);
    assert.equal(frame.statusLeft, 0);
    assert.ok(Math.abs(frame.menuRight - frame.innerWidth) < 0.5, JSON.stringify(frame));
    assert.ok(Math.abs(frame.statusRight - frame.innerWidth) < 0.5, JSON.stringify(frame));
    assert.equal(frame.barWidth, '12px');
    assert.equal(frame.barHeight, '12px');
    assert.equal(frame.buttonWidth, '0px');
    assert.equal(frame.buttonHeight, '0px');
    assert.equal(frame.thumbBorder, '2px');
    assert.equal(frame.thumbRadius, '6px');
    assert.equal(frame.trackColor, 'rgba(0, 0, 0, 0)');
    assert.equal(frame.view, 'pages');
    assert.equal(frame.tabColor, frame.regionColor);
    assert.equal(frame.overflowY, true);

    const shot = decodePng(Buffer.from((await client.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    const scale = shot.width / frame.innerWidth;
    const menuY = Math.round(frame.menuEdge * scale) - 1;
    const statusY = Math.round(frame.statusEdge * scale);
    const mid = Math.round(frame.innerWidth * scale * 0.5);
    const edge = shot.width - 3;
    assert.ok(same(pixel(shot, mid, menuY), pixel(shot, edge, menuY)), `menu hairline ${pixel(shot, mid, menuY)} vs ${pixel(shot, edge, menuY)}`);
    assert.ok(same(pixel(shot, mid, statusY), pixel(shot, edge, statusY)), `status hairline ${pixel(shot, mid, statusY)} vs ${pixel(shot, edge, statusY)}`);
    assert.ok(same(pixel(shot, mid, menuY), pixel(shot, mid, statusY)), 'the two hairlines differ');

    const point = await evaluate(client, `(() => {
      const button = [...document.querySelectorAll('.menu-button')].find((node) => (node.textContent || '').trim().startsWith('View'));
      const rect = button.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`);
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await sleep(50);
    const item = await evaluate(client, `(() => {
      const node = document.querySelector('[data-item="view-pageless"]');
      const rect = node.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    })()`);
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: item.x, y: item.y, button: 'left', clickCount: 1 });
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: item.x, y: item.y, button: 'left', clickCount: 1 });
    await sleep(150);
    const pageless = await evaluate(client, READ);
    assert.equal(pageless.view, 'pageless');
    assert.equal(pageless.tabColor, pageless.regionColor);
    assert.notEqual(pageless.tabColor, frame.tabColor);
  } finally {
    await finish();
  }
});
