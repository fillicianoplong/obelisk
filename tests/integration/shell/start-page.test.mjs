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

const READ_START = `(() => {
  if (document.documentElement.dataset.shellCommands !== 'ready') {
    return null;
  }
  const strip = document.querySelector('[data-region="tab-strip"]');
  const start = document.querySelector('[data-page="start"]');
  const list = document.querySelector('[role="tablist"]');
  const tabs = list ? [...list.querySelectorAll('[role="tab"]')] : [];
  return {
    start: start !== null,
    tabCount: tabs.length,
    newTab: Boolean(document.querySelector('[aria-label="New tab"]')),
    stripCount: strip ? strip.getAttribute('data-tab-count') : null,
  };
})()`;

async function pageTarget(port) {
  const pages = (await debuggerTargets(port)).filter(
    (target) => target.type === 'page' && typeof target.webSocketDebuggerUrl === 'string',
  );
  return pages.length === 1 ? pages[0].webSocketDebuggerUrl : null;
}

test('launch with no file shows the start page and an empty tab strip', { timeout: 60_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-start-'));
  const port = await freePort();
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);
  try {
    session.child = await launchWithSandboxFallback({
      binary: electronBinary(),
      args: ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`],
      startPage: true,
      ready(running) {
        return waitFor(
          running,
          async () => {
            const url = await pageTarget(port);
            if (!url) return null;
            session.client?.close();
            session.client = openCdp(url);
            return evaluate(session.client, READ_START);
          },
          20_000,
        );
      },
    });
    const state = await evaluate(session.client, READ_START);
    assert.equal(state.start, true);
    assert.equal(state.tabCount, 0);
    assert.equal(state.stripCount, '0');
    assert.equal(state.newTab, true);

    await evaluate(
      session.client,
      `(() => {
        document.querySelector('.start-action-primary, .page-setup-button-ok').click();
        return document.querySelector('[data-region="page-editor"]') !== null;
      })()`,
    );
    const after = await waitFor(
      session.child,
      async () => {
        const url = await pageTarget(port);
        if (!url) return null;
        session.client = openCdp(url);
        const editor = await evaluate(session.client, `Boolean(document.querySelector('[data-region="page-editor"]'))`);
        const tabs = await evaluate(session.client, `document.querySelectorAll('[role="tab"]').length`);
        return editor && tabs === 1 ? { editor, tabs } : null;
      },
      8_000,
    );
    assert.equal(after.tabs, 1);
  } finally {
    await finish();
  }
});

test('closing the last tab returns to the start page', { timeout: 60_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-start-close-'));
  const port = await freePort();
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);
  try {
    session.child = await launchWithSandboxFallback({
      binary: electronBinary(),
      args: ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`],
      startPage: true,
      ready(running) {
        return waitFor(
          running,
          async () => {
            const url = await pageTarget(port);
            if (!url) return null;
            session.client = openCdp(url);
            return evaluate(session.client, READ_START);
          },
          20_000,
        );
      },
    });
    await evaluate(
      session.client,
      `document.querySelector('.start-action-primary, .page-setup-button-ok').click();`,
    );
    await waitFor(
      session.child,
      async () => {
        const url = await pageTarget(port);
        if (!url) return null;
        session.client = openCdp(url);
        const tabs = await evaluate(session.client, `document.querySelectorAll('[role="tab"]').length`);
        return tabs === 1 ? true : null;
      },
      8_000,
    );
    await evaluate(
      session.client,
      `(() => {
        const close = document.querySelector('[aria-label="Close tab"]');
        if (close instanceof HTMLElement) close.click();
      })()`,
    );
  const back = await waitFor(
      session.child,
      async () => {
        const state = await evaluate(session.client, READ_START);
        return state?.start === true && state.tabCount === 0 ? state : null;
      },
      8_000,
    );
    assert.equal(back.start, true);
    assert.equal(back.tabCount, 0);
  } finally {
    await finish();
  }
});

test('the start page focuses New document for keyboard users', { timeout: 60_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-start-focus-'));
  const port = await freePort();
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);
  try {
    session.child = await launchWithSandboxFallback({
      binary: electronBinary(),
      args: ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`],
      startPage: true,
      ready(running) {
        return waitFor(
          running,
          async () => {
            const url = await pageTarget(port);
            if (!url) return null;
            session.client = openCdp(url);
            return evaluate(
              session.client,
              `(() => {
                if (document.documentElement.dataset.shellCommands !== 'ready') return null;
                const button = document.querySelector('.start-action-primary');
                return button === document.activeElement;
              })()`,
            );
          },
          20_000,
        );
      },
    });
    const focused = await evaluate(
      session.client,
      `document.querySelector('.start-action-primary') === document.activeElement`,
    );
    assert.equal(focused, true);
  } finally {
    await finish();
  }
});