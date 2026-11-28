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
            const ready = await evaluate(
              session.client,
              `(() => {
                if (document.documentElement.dataset.shellCommands !== 'ready') return false;
                if (document.querySelector('[data-page="start"]') && !document.querySelector('[data-region="page-editor"]')) {
                  document.querySelector('.start-action-primary')?.click();
                }
                return Boolean(document.querySelector('[data-region="page-editor"]'));
              })()`,
            );
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

    const layoutOf = `(() => {
      const page = document.querySelector('[data-region="page"]');
      const canvas = document.querySelector('.page-canvas');
      const tabs = document.querySelector('.tab-strip');
      const bubble = document.querySelector('.find-bubble');
      const shell = document.querySelector('.shell');
      const style = bubble ? getComputedStyle(bubble) : null;
      return {
        canvasTop: canvas ? Math.round(canvas.getBoundingClientRect().top) : null,
        regionTop: page ? Math.round(page.getBoundingClientRect().top) : null,
        tabBottom: tabs ? Math.round(tabs.getBoundingClientRect().bottom) : null,
        bubbleTop: bubble ? Math.round(bubble.getBoundingClientRect().top) : null,
        shellClass: shell ? shell.className : '',
        inPage: bubble !== null && page !== null && bubble.parentElement === page,
        position: style ? style.position : null,
        top: style ? style.top : null,
        right: style ? style.right : null,
        replaceOpen: document.querySelector('[data-region="find-bar"] input[type="text"]') !== null,
        labels: bubble ? [...bubble.querySelectorAll('button')].map((button) => button.getAttribute('aria-label')) : [],
      };
    })()`;

    const before = await evaluate(session.client, layoutOf);
    assert.equal(before.shellClass, 'shell');
    assert.ok(before.canvasTop > before.tabBottom);

    await evaluate(session.client, `(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify(keyEvent('f', { ctrlKey: true }))}));
    })()`);

    const findLayout = await waitFor(
      session.child,
      async () => {
        const layout = await evaluate(session.client, layoutOf);
        return layout?.position === 'absolute' && layout.replaceOpen === false ? layout : null;
      },
      STEP_TIMEOUT_MS,
    );
    assert.equal(findLayout.canvasTop, before.canvasTop);
    assert.equal(findLayout.regionTop, before.regionTop);
    assert.equal(findLayout.shellClass, 'shell');
    assert.equal(findLayout.inPage, true);
    assert.equal(findLayout.top, '8px');
    assert.equal(findLayout.right, '18px');
    const scrolled = await evaluate(session.client, `(() => {
      const region = document.querySelector('.page-region');
      const area = document.querySelector('.page-area');
      const bubble = document.querySelector('.find-bubble');
      const before = bubble.getBoundingClientRect();
      region.scrollTop = 400;
      const scrolledTop = region.scrollTop;
      const after = bubble.getBoundingClientRect();
      region.scrollTop = 0;
      const scrollbar = region.offsetWidth - region.clientWidth;
      return {
        moved: scrolledTop > 0,
        top: Math.round(after.top),
        beforeTop: Math.round(before.top),
        right: Math.round(after.right),
        beforeRight: Math.round(before.right),
        belowTabs: after.top >= document.querySelector('.tab-strip').getBoundingClientRect().bottom,
        clearOfScrollbar: after.right <= area.getBoundingClientRect().right - scrollbar + 1,
      };
    })()`);
    assert.equal(scrolled.moved, true);
    assert.equal(scrolled.top, scrolled.beforeTop);
    assert.equal(scrolled.right, scrolled.beforeRight);
    assert.equal(scrolled.belowTabs, true);
    assert.equal(scrolled.clearOfScrollbar, true);
    assert.ok(findLayout.bubbleTop >= findLayout.tabBottom);
    assert.ok(findLayout.labels.length > 0);
    assert.ok(findLayout.labels.every((label) => typeof label === 'string' && label.length > 0));
    assert.equal(findLayout.labels.includes('Replace'), false);

    await evaluate(session.client, `(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify(keyEvent('h', { ctrlKey: true }))}));
    })()`);

    const replaceLayout = await waitFor(
      session.child,
      async () => {
        const layout = await evaluate(session.client, layoutOf);
        return layout?.replaceOpen === true ? layout : null;
      },
      STEP_TIMEOUT_MS,
    );
    assert.equal(replaceLayout.canvasTop, before.canvasTop);
    assert.equal(replaceLayout.regionTop, before.regionTop);
    assert.ok(replaceLayout.labels.includes('Replace'));
    assert.ok(replaceLayout.labels.includes('Replace all'));
    assert.ok(replaceLayout.labels.every((label) => typeof label === 'string' && label.length > 0));

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
      const whole = document.querySelector('[data-region="find-bar"] [aria-label="Whole word"]');
      if (whole && whole.getAttribute('aria-pressed') !== 'true') {
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
      const clicked = document.querySelector('[data-region="find-bar"] [aria-label="Replace all"]');
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