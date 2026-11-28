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

const READ_ORDER = `(() => {
  const editor = document.querySelector('[data-region="page-editor"]');
  if (document.documentElement.dataset.shellCommands !== 'ready') {
    return null;
  }
  if (document.querySelector('[data-page="start"]') && !editor) {
    document.querySelector('.start-action-primary')?.click();
    return null;
  }
  if (!editor?.editorCommands) {
    return null;
  }
  const ids = [...document.querySelectorAll('[role="tab"]')].map((tab) => tab.getAttribute('data-tab-id'));
  const marker = document.querySelector('.tab-drop-marker') !== null;
  return { ids, marker };
})()`;

async function pageTarget(port) {
  const pages = (await debuggerTargets(port)).filter(
    (target) => target.type === 'page' && typeof target.webSocketDebuggerUrl === 'string',
  );
  return pages.length === 1 ? pages[0].webSocketDebuggerUrl : null;
}

test('dragging a tab shows a drop marker while reordering', { timeout: 90_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-tab-drag-'));
  const port = await freePort();
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);
  try {
    session.child = await launchWithSandboxFallback({
      binary: electronBinary(),
      args: ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`],
      ready(running) {
        return waitFor(
          running,
          async () => {
            const url = await pageTarget(port);
            if (!url) return null;
            session.client?.close();
            session.client = openCdp(url);
            const state = await evaluate(session.client, READ_ORDER);
            return state?.ids.length >= 1 ? state : null;
          },
          20_000,
        );
      },
    });

    await evaluate(session.client, `document.querySelector('[aria-label="New tab"]').click();`);
    await evaluate(session.client, `document.querySelector('[aria-label="New tab"]').click();`);
    await waitFor(
      session.child,
      async () => {
        const state = await evaluate(session.client, READ_ORDER);
        return state?.ids.length === 3 ? state : null;
      },
      8_000,
    );

    const dragged = await evaluate(session.client, `
      (async () => {
        const third = document.querySelector('[data-tab-id="untitled-3"]');
        const list = document.querySelector('.tab-list');
        const rect = third.getBoundingClientRect();
        const targetX = document.querySelector('[data-tab-id="untitled-1"]').getBoundingClientRect().left + 40;
        const down = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: rect.left + 80, clientY: rect.top + 10, button: 0, pointerId: 1, pointerType: 'mouse' });
        third.dispatchEvent(down);
        await new Promise((r) => requestAnimationFrame(r));
        for (let step = 0; step < 6; step += 1) {
          document.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: targetX + step * 8, clientY: rect.top + 10, button: 0, pointerId: 1, pointerType: 'mouse' }));
          await new Promise((r) => requestAnimationFrame(r));
        }
        const drag = list.getAttribute('data-tab-drag') === 'true';
        const marker = document.querySelector('.tab-drop-marker') !== null;
        return { drag, marker };
      })()
    `);
    assert.equal(dragged.drag, true);
    assert.equal(dragged.marker, true);
  } finally {
    await finish();
  }
});