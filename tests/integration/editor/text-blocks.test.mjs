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
  STEP_TIMEOUT_MS,
  waitFor,
} from '../electron-launch.mjs';

const KINDS = [
  'paragraph',
  'heading',
  'bulleted-list',
  'numbered-list',
  'checklist',
  'quote',
  'code',
  'divider',
  'page-break',
];

const READ_SNAPSHOT = `(() => {
  const editor = document.querySelector('[data-region="page-editor"]');
  if (!editor || !editor.editorCommands) {
    return null;
  }
  return editor.editorCommands.blockSnapshot();
})()`;

async function pageTarget(port) {
  const pages = (await debuggerTargets(port)).filter(
    (target) => target.type === 'page' && typeof target.webSocketDebuggerUrl === 'string',
  );
  if (pages.length !== 1) {
    return null;
  }
  return pages[0].webSocketDebuggerUrl;
}

async function launchEditor(session, port) {
  const binary = electronBinary();
  const args = ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${session.userDataDir}`];
  session.child = await launchWithSandboxFallback({
    binary,
    args,
    ready(running) {
      session.client?.close();
      session.client = undefined;
      return waitFor(
        running,
        async () => {
          const url = await pageTarget(port);
          if (!url) {
            return null;
          }
          session.client = openCdp(url);
          const snapshot = await evaluate(session.client, READ_SNAPSHOT);
          return snapshot ? { snapshot, url } : null;
        },
        20_000,
      );
    },
  });
}

async function runCommand(client, body) {
  const result = await evaluate(
    client,
    `(() => {
      const editor = document.querySelector('[data-region="page-editor"]');
      const commands = editor && editor.editorCommands;
      if (!commands) {
        return 'editor commands are not ready';
      }
      ${body}
      return 'ok';
    })()`,
  );
  assert.equal(result, 'ok', result);
}

test('two of each text block can be inserted and edited in a tab', { timeout: 60_000 }, async (t) => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-text-blocks-'));
  const port = await freePort();
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);

  try {
    await launchEditor(session, port);
    for (const kind of KINDS) {
      for (let copy = 0; copy < 2; copy += 1) {
        const label = `${kind}${copy}`;
        await runCommand(
          session.client,
          `commands.insertBlock(${JSON.stringify(kind)}, { text: ${JSON.stringify(label)}, level: 2, after: commands.blockSnapshot().length - 1 });`,
        );
      }
    }

    const deadline = Date.now() + STEP_TIMEOUT_MS;
    let snapshot = null;
    while (Date.now() < deadline) {
      snapshot = await evaluate(session.client, READ_SNAPSHOT);
      if (snapshot && snapshot.length === KINDS.length * 2 + 1) {
        break;
      }
      await sleep(30);
    }
    assert.ok(snapshot, 'block snapshot was not ready');
    assert.equal(snapshot.length, KINDS.length * 2 + 1);

    await runCommand(session.client, 'commands.focusBlock(1, 3); commands.insertText("X");');
    snapshot = await evaluate(session.client, READ_SNAPSHOT);
    assert.match(snapshot[1].text, /X/);

    await runCommand(session.client, 'commands.duplicateBlock(4);');
    snapshot = await evaluate(session.client, READ_SNAPSHOT);
    assert.equal(snapshot.length, KINDS.length * 2 + 2);
    assert.notEqual(snapshot[4].id, snapshot[5].id);

    const status = await evaluate(
      session.client,
      `(() => {
        const node = document.querySelector('[data-status-item="save"]');
        return node ? (node.textContent || '').trim() : '';
      })()`,
    );
    assert.equal(status, 'Unsaved changes');
  } finally {
    await finish();
  }
});
