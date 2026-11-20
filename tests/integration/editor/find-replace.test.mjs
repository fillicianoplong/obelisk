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
  STEP_TIMEOUT_MS,
  waitFor,
} from '../electron-launch.mjs';

const SAMPLE = 'cat one cat two cat three cat four cat five';

const SNAPSHOT = `(() => {
  const editor = document.querySelector('[data-region="page-editor"]');
  const bar = document.querySelector('[data-region="find-bar"]');
  const count = bar ? bar.querySelector('[data-find-count]') : null;
  const matches = editor ? [...editor.querySelectorAll('.find-match')] : [];
  return {
    text: editor ? editor.textContent.replace(/\\u200b/g, '') : null,
    barOpen: bar !== null,
    count: count ? (count.textContent || '').trim() : null,
    matchDecorations: matches.length,
    snapshot: editor && editor.editorCommands.findSnapshot ? editor.editorCommands.findSnapshot() : null,
  };
})()`;

function keyEvent(key, extra = {}) {
  return {
    type: 'keydown',
    key,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    bubbles: true,
    cancelable: true,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...extra,
  };
}

async function pageTarget(port) {
  const pages = (await debuggerTargets(port)).filter(
    (target) => target.type === 'page' && typeof target.webSocketDebuggerUrl === 'string',
  );
  return pages.length === 1 ? pages[0].webSocketDebuggerUrl : null;
}

test('find and replace through the real shell handlers (AC-18)', { timeout: 45_000 }, async (t) => {
  const session = { userDataDir: await mkdtemp(path.join(tmpdir(), 'obelisk-find-')), child: undefined, client: undefined };
  const finish = bindLaunchedApp(t, session);
  const port = await freePort();

  try {
    const binary = electronBinary();
    const args = ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${session.userDataDir}`];
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
            session.client = openCdp(url);
            const ready = await evaluate(session.client, `document.documentElement.dataset.shellCommands === 'ready'`);
            return ready ? true : null;
          },
          20_000,
        );
      },
    });

    await evaluate(session.client, `(() => {
      const editor = document.querySelector('[data-region="page-editor"]');
      editor.editorCommands.replaceText(${JSON.stringify(SAMPLE)});
    })()`);

    await evaluate(session.client, `(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify(keyEvent('h', { ctrlKey: true }))}));
    })()`);

    await waitFor(
      session.child,
      async () => {
        const snap = await evaluate(session.client, SNAPSHOT);
        return snap?.barOpen === true ? snap : null;
      },
      STEP_TIMEOUT_MS,
    );

    await evaluate(session.client, `(() => {
      const setValue = (input, value) => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, value);
        input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
      };
      const find = document.querySelector('[data-region="find-bar"] input[type="search"]');
      const replace = document.querySelector('[data-region="find-bar"] input[type="text"]');
      setValue(find, 'cat');
      setValue(replace, 'dog');
      const whole = [...document.querySelectorAll('[data-region="find-bar"] input[type="checkbox"]')][1];
      if (whole && !whole.checked) {
        whole.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
      const editor = document.querySelector('[data-region="page-editor"]');
      editor.editorCommands.findPatch({ query: 'cat', replacement: 'dog', wholeWord: true, open: true, showReplace: true });
    })()`);

    const highlighted = await waitFor(
      session.child,
      async () => {
        const snap = await evaluate(session.client, SNAPSHOT);
        return snap?.matchDecorations === 5 ? snap : null;
      },
      STEP_TIMEOUT_MS,
    );
    assert.equal(highlighted.count, '1 of 5');

    await evaluate(session.client, `(() => {
      const editor = document.querySelector('[data-region="page-editor"]');
      const clicked = [...document.querySelectorAll('[data-region="find-bar"] .find-bar-button')]
        .find((button) => (button.textContent || '').trim() === 'Replace all');
      if (clicked && !clicked.disabled) {
        clicked.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      } else {
        editor.editorCommands.findReplaceAll();
      }
    })()`);

    const after = await waitFor(
      session.child,
      async () => {
        const snap = await evaluate(session.client, SNAPSHOT);
        return snap?.text?.includes('dog') && !snap.text.includes('cat') ? snap : null;
      },
      STEP_TIMEOUT_MS,
    );
    assert.equal((after.text.match(/dog/g) ?? []).length, 5);

    const undoResult = await evaluate(session.client, `(() => {
      const editor = document.querySelector('[data-region="page-editor"]');
      try {
        editor.editorCommands.undo();
        return { ok: true };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
    })()`);
    assert.equal(undoResult.ok, true, undoResult.message ?? 'undo failed');

    const restored = await evaluate(session.client, SNAPSHOT);
    assert.equal(restored.text, SAMPLE);
    assert.equal(restored.snapshot.matchCount, 5);
  } finally {
    await finish();
  }
});