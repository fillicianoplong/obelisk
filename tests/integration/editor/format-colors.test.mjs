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

const SHELL_READY = `document.documentElement.dataset.shellCommands === 'ready'
  && Boolean(document.querySelector('[data-region="page-editor"]')?.editorCommands)`;

const READ_COLOR = `(() => {
  const editor = document.querySelector('[data-region="page-editor"]');
  if (!editor) {
    return null;
  }
  const span = editor.querySelector('span[data-text-color]');
  if (!span) {
    return null;
  }
  return {
    color: getComputedStyle(span).color,
    attr: span.getAttribute('data-text-color'),
  };
})()`;

async function pageTarget(port) {
  const pages = (await debuggerTargets(port)).filter(
    (target) => target.type === 'page' && typeof target.webSocketDebuggerUrl === 'string',
  );
  return pages.length === 1 ? pages[0].webSocketDebuggerUrl : null;
}

test('text color from character marks shows in computed styles under the app CSP', { timeout: 45_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-format-color-'));
  const port = await freePort();
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);

  try {
    const binary = electronBinary();
    const args = ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`];
    session.child = await launchWithSandboxFallback({
      binary,
      args,
      ready(child) {
        return waitFor(
          child,
          async () => {
            const url = await pageTarget(port);
            if (!url) {
              return null;
            }
            if (!session.client) {
              session.client = openCdp(url);
            }
            const ready = await evaluate(session.client, SHELL_READY);
            return ready ? true : null;
          },
          20_000,
        );
      },
    });

    await evaluate(
      session.client,
      `(() => {
        const editor = document.querySelector('[data-region="page-editor"]');
        editor.editorCommands.insertText('Color sample');
        editor.editorCommands.selectAllDocument();
        editor.editorCommands.applyCharacterMarks({ color: '#B3261E' });
        return 'ok';
      })()`,
    );

    let sample = null;
    const deadline = Date.now() + 8_000;
    while (Date.now() < deadline) {
      sample = await evaluate(session.client, READ_COLOR);
      if (sample?.attr === '#b3261e' && sample.color === 'rgb(179, 38, 30)') {
        break;
      }
      await sleep(30);
    }
    assert.equal(sample?.attr, '#b3261e');
    assert.equal(sample?.color, 'rgb(179, 38, 30)');

    await evaluate(
      session.client,
      `(() => {
        const editor = document.querySelector('[data-region="page-editor"]');
        editor.editorCommands.replaceText('Plain yellow ink');
        editor.editorCommands.setSelection(7, 13);
        editor.editorCommands.applyCharacterMarks({ highlight: '#F3E3A1' });
        return 'ok';
      })()`,
    );

    const readHighlight = (theme) => `(() => {
      document.documentElement.setAttribute('data-theme', '${theme}');
      const editor = document.querySelector('[data-region="page-editor"]');
      const paragraph = editor.querySelector('p');
      const span = editor.querySelector('span[data-highlight]');
      const sheetRules = [...document.adoptedStyleSheets].flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText)).join('\\n');
      return {
        plain: getComputedStyle(paragraph).color,
        color: getComputedStyle(span).color,
        background: getComputedStyle(span).backgroundColor,
        attr: span.getAttribute('data-highlight'),
        inlineStyle: span.hasAttribute('style'),
        styleTag: editor.querySelector('style') !== null,
        styled: editor.querySelector('[style]') !== null,
        sheetRules,
      };
    })()`;

    let light = null;
    const lightDeadline = Date.now() + 8_000;
    while (Date.now() < lightDeadline) {
      light = await evaluate(session.client, readHighlight('light'));
      if (light?.attr === '#f3e3a1' && light.background === 'rgb(243, 227, 161)') {
        break;
      }
      await sleep(30);
    }
    assert.equal(light.attr, '#f3e3a1');
    assert.equal(light.background, 'rgb(243, 227, 161)');
    assert.equal(light.color, light.plain);
    assert.equal(light.color, 'rgb(31, 38, 48)');
    assert.equal(light.inlineStyle, false);
    assert.equal(light.styleTag, false);
    assert.equal(light.styled, false);

    const dark = await evaluate(session.client, readHighlight('dark'));
    assert.equal(dark.background, 'rgb(243, 227, 161)');
    assert.equal(dark.color, 'rgb(31, 38, 48)');
    assert.notEqual(dark.color, dark.plain);

    await evaluate(
      session.client,
      `(() => {
        const editor = document.querySelector('[data-region="page-editor"]');
        editor.editorCommands.setSelection(7, 13);
        editor.editorCommands.applyCharacterMarks({ color: '#B3261E' });
        editor.editorCommands.setSelection(14, 17);
        editor.editorCommands.applyCharacterMarks({ highlight: '#1B2838' });
        return 'ok';
      })()`,
    );

    const explicit = await evaluate(session.client, `(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
      const editor = document.querySelector('[data-region="page-editor"]');
      const yellow = editor.querySelector('span[data-highlight="#f3e3a1"]');
      const night = editor.querySelector('span[data-highlight="#1b2838"]');
      const paragraph = editor.querySelector('p');
      return {
        yellow: getComputedStyle(yellow).color,
        yellowBackground: getComputedStyle(yellow).backgroundColor,
        night: getComputedStyle(night).color,
        nightBackground: getComputedStyle(night).backgroundColor,
        plain: getComputedStyle(paragraph).color,
        inline: yellow.hasAttribute('style') || night.hasAttribute('style'),
      };
    })()`);
    assert.equal(explicit.yellow, 'rgb(179, 38, 30)');
    assert.equal(explicit.yellowBackground, 'rgb(243, 227, 161)');
    assert.equal(explicit.nightBackground, 'rgb(27, 40, 56)');
    assert.equal(explicit.night, explicit.plain);
    assert.notEqual(explicit.night, 'rgb(31, 38, 48)');
    assert.equal(explicit.inline, false);

    const lightExplicit = await evaluate(session.client, `(() => {
      document.documentElement.setAttribute('data-theme', 'light');
      const editor = document.querySelector('[data-region="page-editor"]');
      const yellow = editor.querySelector('span[data-highlight="#f3e3a1"]');
      const plain = editor.querySelector('p');
      return {
        yellow: getComputedStyle(yellow).color,
        plain: getComputedStyle(plain).color,
        background: getComputedStyle(yellow).backgroundColor,
      };
    })()`);
    assert.equal(lightExplicit.yellow, 'rgb(179, 38, 30)');
    assert.equal(lightExplicit.plain, 'rgb(31, 38, 48)');
    assert.equal(lightExplicit.background, 'rgb(243, 227, 161)');
  } finally {
    await finish();
  }
});
