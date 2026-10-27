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
  waitFor,
} from '../electron-launch.mjs';

const READY = `(() => {
  const frame = document.querySelector('.page-frame');
  const sheet = document.querySelector('.page-sheet');
  const header = document.querySelector('[data-page-part="header"]');
  const region = document.querySelector('.page-region');
  if (!frame || !sheet || !header || !region || !sheet.editorCommands) {
    return null;
  }
  if (sheet.getAttribute('contenteditable') !== 'true') {
    return null;
  }
  if (document.documentElement.dataset.shellCommands !== 'ready') {
    return null;
  }
  return true;
})()`;

const MEASURE = `(() => {
  const frame = document.querySelector('.page-frame');
  const sheet = document.querySelector('.page-sheet');
  const header = document.querySelector('[data-page-part="header"]');
  const region = document.querySelector('.page-region');
  const paragraph = sheet.querySelector('p');
  const frameRect = frame.getBoundingClientRect();
  const sheetRect = sheet.getBoundingClientRect();
  const headerRect = header.getBoundingClientRect();
  const regionRect = region.getBoundingClientRect();
  const regionStyle = getComputedStyle(region);
  const sheetStyle = getComputedStyle(sheet);
  const paragraphStyle = paragraph ? getComputedStyle(paragraph) : null;
  const probe = document.createElement('span');
  probe.style.boxShadow = 'var(--shadow-page)';
  probe.style.color = 'CanvasText';
  document.body.appendChild(probe);
  const probeStyle = getComputedStyle(probe);
  const tokenShadow = probeStyle.boxShadow;
  const canvasText = probeStyle.color;
  probe.remove();
  const padLeft = parseFloat(regionStyle.paddingLeft);
  const padRight = parseFloat(regionStyle.paddingRight);
  const contentLeft = regionRect.left + region.clientLeft + padLeft;
  const contentRight = contentLeft + region.clientWidth - padLeft - padRight;
  const faces = [];
  for (const face of document.fonts) {
    faces.push({
      family: face.family,
      weight: face.weight,
      style: face.style,
      status: face.status,
    });
  }
  const sources = [];
  for (const sheetNode of document.styleSheets) {
    let rules;
    try {
      rules = sheetNode.cssRules;
    } catch {
      continue;
    }
    for (const rule of rules) {
      if (rule.type !== CSSRule.FONT_FACE_RULE) {
        continue;
      }
      sources.push({
        family: rule.style.getPropertyValue('font-family'),
        src: rule.style.getPropertyValue('src'),
        weight: rule.style.getPropertyValue('font-weight'),
        style: rule.style.getPropertyValue('font-style'),
      });
    }
  }
  return {
    zoom: (document.querySelector('[data-status-item="zoom"]')?.textContent || '').trim(),
    frame: { width: frameRect.width, height: frameRect.height },
    sheet: { width: sheetRect.width, height: sheetRect.height },
    padding: {
      top: sheetStyle.paddingTop,
      right: sheetStyle.paddingRight,
      bottom: sheetStyle.paddingBottom,
      left: sheetStyle.paddingLeft,
    },
    header: {
      text: header.textContent || '',
      editable: header.getAttribute('contenteditable'),
      top: headerRect.top - frameRect.top,
      left: headerRect.left - frameRect.left,
      height: headerRect.height,
      width: headerRect.width,
    },
    gap: {
      paddingTop: regionStyle.paddingTop,
      visualLeft: frameRect.left - regionRect.left,
      visualRight: regionRect.right - frameRect.right,
      contentLeft: frameRect.left - contentLeft,
      contentRight: contentRight - frameRect.right,
    },
    scroll: {
      scrollLeft: region.scrollLeft,
      regionClient: region.clientWidth,
      regionScroll: region.scrollWidth,
      documentClient: document.documentElement.clientWidth,
      documentScroll: document.documentElement.scrollWidth,
    },
    textLeft: paragraph ? paragraph.getBoundingClientRect().left - regionRect.left : 0,
    font: {
      family: sheetStyle.fontFamily,
      size: sheetStyle.fontSize,
      paragraphFamily: paragraphStyle ? paragraphStyle.fontFamily : '',
      paragraphSize: paragraphStyle ? paragraphStyle.fontSize : '',
      text: paragraph ? (paragraph.textContent || '').replace(/\\u200b/g, '') : '',
    },
    edge: {
      shadow: sheetStyle.boxShadow,
      tokenShadow,
      borderTopWidth: sheetStyle.borderTopWidth,
      borderTopStyle: sheetStyle.borderTopStyle,
      borderTopColor: sheetStyle.borderTopColor,
      canvasText,
      forced: window.matchMedia('(forced-colors: active)').matches,
      theme: document.documentElement.dataset.theme || '',
    },
    faces,
    sources,
  };
})()`;

function near(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 0.6, `${label}: ${actual} expected ${expected}`);
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

test('a new document is a Letter sheet with a header band and bundled text', { timeout: 60_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-page-sheet-'));
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);

  try {
    const binary = electronBinary();
    const port = await freePort();
    session.child = await launchWithSandboxFallback({
      binary,
      args: ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`, '--force-device-scale-factor=1'],
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
    const client = await openPage(port, session);
    await evaluate(client, `document.fonts.ready.then(() => true)`);
    await evaluate(
      client,
      `document.querySelector('.page-sheet').editorCommands.insertText('A Letter page for class.')`,
    );
    await evaluate(client, `document.fonts.ready.then(() => true)`);

    const wide = await evaluate(client, MEASURE);
    assert.equal(wide.zoom, '100%');
    near(wide.frame.width, 816, 'frame width');
    near(wide.frame.height, 1056, 'frame height');
    near(wide.sheet.width, 816, 'sheet width');
    near(wide.sheet.height, 1056, 'sheet height');
    assert.equal(wide.padding.top, '96px');
    assert.equal(wide.padding.right, '96px');
    assert.equal(wide.padding.bottom, '96px');
    assert.equal(wide.padding.left, '96px');
    assert.equal(wide.gap.paddingTop, '24px');
    assert.ok(wide.gap.visualLeft >= 24, `left gap ${wide.gap.visualLeft}`);
    assert.ok(wide.gap.visualRight >= 24, `right gap ${wide.gap.visualRight}`);
    assert.equal(wide.header.text, '');
    assert.equal(wide.header.editable, null);
    near(wide.header.top, 48, 'header offset');
    near(wide.header.left, 96, 'header left');
    near(wide.header.height, 48, 'header height');
    near(wide.header.width, 816 - 192, 'header width');
    assert.equal(wide.font.text, 'A Letter page for class.');
    assert.equal(wide.font.size, '16px');
    assert.equal(wide.font.paragraphSize, '16px');
    assert.match(wide.font.family, /Liberation Serif/);
    assert.match(wide.font.paragraphFamily, /Liberation Serif/);
    assert.ok(
      Math.abs(wide.gap.contentLeft - wide.gap.contentRight) <= 1,
      `centered ${wide.gap.contentLeft} ${wide.gap.contentRight}`,
    );
    const regular = wide.faces.find((face) => face.family.replaceAll('"', '') === 'Liberation Serif'
      && (face.weight === '400' || face.weight === 'normal')
      && face.style === 'normal');
    assert.ok(regular, `no regular face in ${JSON.stringify(wide.faces)}`);
    assert.equal(regular.status, 'loaded');
    const regularSrc = wide.sources.find((source) => source.src.includes('LiberationSerif-Regular.ttf'));
    assert.ok(regularSrc, `font src missing ${JSON.stringify(wide.sources)}`);
    assert.equal(regularSrc.src.includes('local('), false);
    assert.equal(/https?:/.test(regularSrc.src), false);
    const loadedFrom = await evaluate(
      client,
      `(() => {
        const found = [];
        for (const sheet of document.styleSheets) {
          let rules;
          try {
            rules = sheet.cssRules;
          } catch {
            continue;
          }
          for (const rule of rules) {
            if (rule.type !== CSSRule.FONT_FACE_RULE) {
              continue;
            }
            const src = rule.style.getPropertyValue('src');
            const match = /url\\((['"]?)([^'")]+)\\1\\)/.exec(src);
            if (!match) {
              continue;
            }
            found.push(new URL(match[2], sheet.href || document.baseURI).href);
          }
        }
        return found;
      })()`,
    );
    assert.ok(
      loadedFrom.some((name) => name.startsWith('app://obelisk/fonts/LiberationSerif-Regular.ttf')),
      JSON.stringify(loadedFrom),
    );

    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 640,
      height: 480,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evaluate(
      client,
      `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`,
    );
    const narrow = await evaluate(client, MEASURE);
    near(narrow.frame.width, 816, 'narrow frame width');
    near(narrow.sheet.width, 816, 'narrow sheet width');
    assert.equal(narrow.scroll.scrollLeft, 0, JSON.stringify(narrow.scroll));
    near(narrow.gap.visualLeft, 24, 'narrow left edge');
    near(narrow.textLeft - narrow.gap.visualLeft, 96, 'narrow left margin');
    assert.ok(narrow.textLeft < narrow.scroll.regionClient, `text at the window edge ${narrow.textLeft}`);
    assert.ok(narrow.scroll.regionScroll > narrow.scroll.regionClient + 1, JSON.stringify(narrow.scroll));
    assert.ok(narrow.scroll.documentScroll <= narrow.scroll.documentClient + 1, JSON.stringify(narrow.scroll));
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 520,
      height: 480,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await evaluate(
      client,
      `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`,
    );
    const resized = await evaluate(client, MEASURE);
    assert.equal(resized.scroll.scrollLeft, 0, JSON.stringify(resized.scroll));
    near(resized.gap.visualLeft, 24, 'resized left edge');
    near(resized.frame.width, 816, 'resized frame width');
    const reach = await evaluate(
      client,
      `(() => {
        const region = document.querySelector('.page-region');
        const frame = document.querySelector('.page-frame');
        region.scrollLeft = 0;
        const start = frame.getBoundingClientRect().left - region.getBoundingClientRect().left;
        region.scrollLeft = region.scrollWidth;
        const endFrame = frame.getBoundingClientRect();
        const endRegion = region.getBoundingClientRect();
        return {
          start,
          frameRight: endFrame.right,
          regionRight: endRegion.right,
          scrollLeft: region.scrollLeft,
        };
      })()`,
    );
    assert.ok(reach.start >= -1, `left edge clipped ${JSON.stringify(reach)}`);
    assert.ok(reach.frameRight <= reach.regionRight + 1, `right edge clipped ${JSON.stringify(reach)}`);
    assert.ok(reach.scrollLeft > 0, JSON.stringify(reach));
    await client.send('Emulation.clearDeviceMetricsOverride');

    await evaluate(client, `document.documentElement.dataset.theme = 'light'`);
    const light = await evaluate(client, MEASURE);
    assert.equal(light.edge.theme, 'light');
    assert.notEqual(light.edge.shadow, 'none');
    assert.equal(light.edge.shadow, light.edge.tokenShadow);

    await evaluate(client, `document.documentElement.dataset.theme = 'dark'`);
    const dark = await evaluate(client, MEASURE);
    assert.equal(dark.edge.theme, 'dark');
    assert.notEqual(dark.edge.shadow, 'none');
    assert.equal(dark.edge.shadow, dark.edge.tokenShadow);
    assert.notEqual(dark.edge.shadow, light.edge.shadow);

    await client.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'forced-colors', value: 'active' }],
    });
    const contrast = await evaluate(client, MEASURE);
    assert.equal(contrast.edge.forced, true);
    assert.equal(contrast.edge.shadow, 'none');
    assert.equal(contrast.edge.borderTopStyle, 'solid');
    near(parseFloat(contrast.edge.borderTopWidth), 1, 'contrast outline');
    assert.equal(contrast.edge.borderTopColor, contrast.edge.canvasText);
    await client.send('Emulation.setEmulatedMedia', { features: [] });
  } finally {
    await finish();
  }
});
