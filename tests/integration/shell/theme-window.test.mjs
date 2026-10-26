import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  bindLaunchedApp,
  closeElectron,
  debuggerTargets,
  electronBinary,
  evaluate,
  freePort,
  launchWithSandboxFallback,
  openCdp,
  waitFor,
} from '../electron-launch.mjs';

const READY = `(() => {
  const title = document.querySelector('[data-region="title-bar"]');
  const page = document.querySelector('.page-sheet');
  const tab = document.querySelector('[role="tab"][aria-selected="true"]');
  if (!title || !page || !tab || !window.obeliskTheme || document.title !== 'Obelisk') {
    return null;
  }
  return true;
})()`;

function themeProbe() {
  return `(async () => {
    const result = await window.obeliskTheme.get();
    const title = getComputedStyle(document.querySelector('[data-region="title-bar"]'));
    return {
      attribute: document.documentElement.getAttribute('data-theme'),
      dark: window.matchMedia('(prefers-color-scheme: dark)').matches,
      reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      forced: window.matchMedia('(forced-colors: active)').matches,
      result,
      hasInvoke: Object.prototype.hasOwnProperty.call(window.obelisk, 'theme:get'),
      titleBackground: title.backgroundColor,
    };
  })()`;
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

async function launchThemed(session, theme) {
  const binary = electronBinary();
  const port = await freePort();
  if (theme !== null) {
    await writeFile(
      path.join(session.userDataDir, 'settings.json'),
      `${JSON.stringify({ theme })}\n`,
    );
  }
  const args = ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${session.userDataDir}`];
  session.child = await launchWithSandboxFallback({
    binary,
    args,
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
  return { port, client };
}

test('the settings file chooses Light or Dark, and Match Windows leaves data-theme unset', { timeout: 90_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-theme-window-'));
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);

  try {
    const dark = await launchThemed(session, 'dark');
    const darkState = await evaluate(dark.client, themeProbe());
    assert.equal(darkState.attribute, 'dark', JSON.stringify(darkState));
    assert.equal(darkState.dark, true, JSON.stringify(darkState));
    assert.deepEqual(darkState.result, { status: 'ok', theme: 'dark' });
    assert.equal(darkState.hasInvoke, false);
    assert.equal(darkState.forced, false);

    await closeElectron(session.child, undefined);
    session.child = undefined;
    session.client?.close();
    session.client = undefined;

    const lightDir = await mkdtemp(path.join(tmpdir(), 'obelisk-theme-light-'));
    session.userDataDir = lightDir;
    const light = await launchThemed(session, 'light');
    const lightState = await evaluate(light.client, themeProbe());
    assert.equal(lightState.attribute, 'light', JSON.stringify(lightState));
    assert.equal(lightState.dark, false, JSON.stringify(lightState));
    assert.deepEqual(lightState.result, { status: 'ok', theme: 'light' });

    await closeElectron(session.child, undefined);
    session.child = undefined;
    session.client?.close();
    session.client = undefined;

    const systemDir = await mkdtemp(path.join(tmpdir(), 'obelisk-theme-system-'));
    session.userDataDir = systemDir;
    const system = await launchThemed(session, null);
    const systemState = await evaluate(system.client, themeProbe());
    assert.equal(systemState.attribute, null, JSON.stringify(systemState));
    assert.deepEqual(systemState.result, { status: 'ok', theme: 'system' });

    await system.client.send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'forced-colors', value: 'active' },
        { name: 'prefers-reduced-motion', value: 'reduce' },
      ],
    });
    const contrast = await evaluate(
      system.client,
      `(() => {
        const page = document.querySelector('.page-sheet');
        const tab = document.querySelector('[role="tab"][aria-selected="true"]');
        const title = document.querySelector('[data-region="title-bar"]');
        const menu = document.querySelector('.menu-button');
        tab.focus();
        const pageStyle = getComputedStyle(page);
        const tabStyle = getComputedStyle(tab);
        const titleStyle = getComputedStyle(title);
        const menuStyle = getComputedStyle(menu);
        const mark = tab.querySelector('.tab-unsaved');
        tab.setAttribute('data-unsaved', 'true');
        const markStyle = getComputedStyle(mark);
        return {
          forced: window.matchMedia('(forced-colors: active)').matches,
          reduced: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
          pageBorder: pageStyle.borderTopWidth,
          pageBorderStyle: pageStyle.borderTopStyle,
          tabBorder: tabStyle.borderTopWidth,
          tabBorderStyle: tabStyle.borderTopStyle,
          tabWeight: tabStyle.fontWeight,
          tabBackground: tabStyle.backgroundColor,
          titleBackground: titleStyle.backgroundColor,
          titleColor: titleStyle.color,
          outlineStyle: tabStyle.outlineStyle,
          outlineWidth: tabStyle.outlineWidth,
          focusRing: getComputedStyle(document.documentElement).getPropertyValue('--size-focus-ring').trim(),
          duration: menuStyle.transitionDuration,
          markDisplay: markStyle.display,
          markWidth: markStyle.width,
          markColor: markStyle.backgroundColor,
        };
      })()`,
    );
    assert.equal(contrast.forced, true, JSON.stringify(contrast));
    assert.equal(contrast.reduced, true, JSON.stringify(contrast));
    assert.equal(contrast.pageBorderStyle, 'solid', JSON.stringify(contrast));
    assert.ok(parseFloat(contrast.pageBorder) > 0, JSON.stringify(contrast));
    assert.equal(contrast.tabBorderStyle, 'solid', JSON.stringify(contrast));
    assert.ok(parseFloat(contrast.tabBorder) > 0, JSON.stringify(contrast));
    assert.equal(String(contrast.tabWeight), '600', JSON.stringify(contrast));
    assert.equal(contrast.outlineStyle, 'solid', JSON.stringify(contrast));
    assert.ok(parseFloat(contrast.outlineWidth) > 0, JSON.stringify(contrast));
    assert.equal(contrast.focusRing, '2px', JSON.stringify(contrast));
    assert.equal(contrast.markDisplay, 'block', JSON.stringify(contrast));
    assert.notEqual(contrast.markWidth, '0px', JSON.stringify(contrast));
    const slate = new Set(['rgb(230, 234, 240)', 'rgb(32, 37, 44)', 'rgb(237, 240, 244)', 'rgb(22, 25, 30)']);
    assert.equal(slate.has(contrast.titleBackground), false, JSON.stringify(contrast));
    assert.match(contrast.duration, /^(?:0s)(?:, 0s)*$/, JSON.stringify(contrast));
  } finally {
    await finish();
  }
});
