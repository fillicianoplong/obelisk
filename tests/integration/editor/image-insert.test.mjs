import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { gifFrames, pngHeader } from '../../../scripts/make-hostile-fixtures/images.mjs';
import {
  IMAGE_INSERT_DIMENSIONS,
  IMAGE_INSERT_TOO_LARGE,
} from '../../../dist/shared/images/messages.js';
import { MB } from '../../../dist/shared/schema/index.js';
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

const READY = `(() => {
  const editor = document.querySelector('[data-region="page-editor"]');
  if (!editor || !editor.editorCommands) {
    return null;
  }
  if (document.documentElement.dataset.shellCommands !== 'ready') {
    return null;
  }
  return true;
})()`;

const SNAPSHOT = `(() => {
  const editor = document.querySelector('[data-region="page-editor"]');
  if (!editor || !editor.editorCommands) {
    return null;
  }
  return editor.editorCommands.blockSnapshot();
})()`;

const NOTICE = `(() => {
  const node = document.querySelector('.open-notice-text');
  return node ? node.textContent : null;
})()`;

async function launchEditor(session, port, env = {}) {
  const binary = electronBinary();
  const args = ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${session.userDataDir}`];
  session.child = await launchWithSandboxFallback({
    binary,
    args,
    env,
    ready(running) {
      session.client?.close();
      session.client = undefined;
      return waitFor(
        running,
        async () => {
          const pages = (await debuggerTargets(port)).filter(
            (target) => target.type === 'page' && target.webSocketDebuggerUrl,
          );
          if (pages.length !== 1) {
            return null;
          }
          session.client = openCdp(pages[0].webSocketDebuggerUrl);
          const ready = await evaluate(session.client, READY);
          return ready ? true : null;
        },
        25_000,
      );
    },
  });
  return session.client;
}

async function waitForSnapshot(client, predicate, label) {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const snapshot = await evaluate(client, SNAPSHOT);
    if (snapshot && predicate(snapshot)) {
      return snapshot;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForNotice(client, expected, label) {
  const deadline = Date.now() + STEP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const notice = await evaluate(client, NOTICE);
    if (notice === expected) {
      return notice;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for notice: ${label}`);
}

async function insertImage(client) {
  await evaluate(client, `(() => {
    const editor = document.querySelector('[data-region="page-editor"]');
    editor.editorCommands.runMenuCommand('insert-image');
    editor.focus();
  })()`);
}

async function withImageInsertFixture(t, pickPath, run) {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-image-app-'));
  const port = await freePort();
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);
  try {
    const client = await launchEditor(session, port, { OBELISK_IMAGE_PICK_PATH: pickPath });
    await run(client);
  } finally {
    await finish();
  }
}

test('AC-19: Insert > Image inserts a PNG', { timeout: 60_000 }, async (t) => {
  const work = await mkdtemp(path.join(tmpdir(), 'obelisk-image-insert-'));
  const pngPath = path.join(work, 'sample.png');
  await writeFile(pngPath, pngHeader(10, 10));
  try {
    await withImageInsertFixture(t, pngPath, async (client) => {
      await insertImage(client);
      const snapshot = await waitForSnapshot(
        client,
        (blocks) => blocks.some((block) => block.type === 'image'),
        'PNG image block',
      );
      assert.equal(snapshot.some((block) => block.type === 'image'), true);
    });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test('AC-19: Insert > Image inserts an animated GIF', { timeout: 60_000 }, async (t) => {
  const work = await mkdtemp(path.join(tmpdir(), 'obelisk-image-insert-'));
  const gifPath = path.join(work, 'spin.gif');
  await writeFile(gifPath, gifFrames(8, 8, [
    { x: 0, y: 0, width: 8, height: 8 },
    { x: 0, y: 0, width: 8, height: 8 },
  ]));
  try {
    await withImageInsertFixture(t, gifPath, async (client) => {
      await insertImage(client);
      const snapshot = await waitForSnapshot(
        client,
        (blocks) => blocks.some((block) => block.type === 'image'),
        'GIF image block',
      );
      assert.ok(snapshot.some((block) => block.type === 'image'));
      const gifSrc = await evaluate(client, `(() => {
        const img = document.querySelector('.image-block-img');
        return img ? img.getAttribute('src') : null;
      })()`);
      assert.ok(gifSrc && gifSrc.startsWith('blob:'));
    });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test('AC-19: Insert > Image refuses a 25 MB file with the size message', { timeout: 90_000 }, async (t) => {
  const work = await mkdtemp(path.join(tmpdir(), 'obelisk-image-insert-'));
  const hugePath = path.join(work, 'huge.png');
  const twentyFiveMb = 25 * MB;
  assert.equal(twentyFiveMb, 25 * 1024 * 1024);
  const huge = Buffer.alloc(twentyFiveMb);
  huge.set(pngHeader(6, 6));
  await writeFile(hugePath, huge);
  try {
    await withImageInsertFixture(t, hugePath, async (client) => {
      await insertImage(client);
      const notice = await waitForNotice(client, IMAGE_INSERT_TOO_LARGE, '25 MB refusal');
      assert.equal(notice, IMAGE_INSERT_TOO_LARGE);
    });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});

test('AC-19: Insert > Image refuses an 8001-pixel image', { timeout: 60_000 }, async (t) => {
  const work = await mkdtemp(path.join(tmpdir(), 'obelisk-image-insert-'));
  const widePath = path.join(work, 'wide.png');
  await writeFile(widePath, pngHeader(8001, 4));
  try {
    await withImageInsertFixture(t, widePath, async (client) => {
      await insertImage(client);
      const notice = await waitForNotice(client, IMAGE_INSERT_DIMENSIONS, '8001 px refusal');
      assert.equal(notice, IMAGE_INSERT_DIMENSIONS);
    });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});