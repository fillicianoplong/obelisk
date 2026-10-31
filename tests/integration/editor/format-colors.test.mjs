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
  } finally {
    await finish();
  }
});
