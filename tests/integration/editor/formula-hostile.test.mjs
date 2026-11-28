import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { encodeObk } from '../../../dist/main/codec/encode/index.js';
import { emptyManifest } from '../../../scripts/make-hostile-fixtures/documents.mjs';
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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const PREVIEWS = `(() => {
  const editor = document.querySelector('[data-region="page-editor"]');
  const commands = editor && editor.editorCommands;
  if (!commands || typeof commands.equationPreviews !== 'function') {
    return null;
  }
  const rows = commands.equationPreviews();
  return rows.length > 0 ? rows : null;
})()`;

async function pageTarget(port) {
  const pages = (await debuggerTargets(port)).filter(
    (target) => target.type === 'page' && typeof target.webSocketDebuggerUrl === 'string',
  );
  return pages.length === 1 ? pages[0].webSocketDebuggerUrl : null;
}

async function hostileJson(name) {
  const generated = await import('../../../scripts/make-hostile-fixtures/generate.mjs');
  const dir = await mkdtemp(path.join(tmpdir(), 'obelisk-hostile-json-'));
  const cases = (await generated.generateHostileFixtures(dir, root)).cases;
  const row = cases.find((item) => item.fileName === name);
  assert.ok(row, name);
  return JSON.parse(await readFile(row.filePath, 'utf8'));
}

async function launchHostileFile(t, filePath, expectCount) {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-formula-hostile-'));
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);
  const port = await freePort();
  session.child = await launchWithSandboxFallback({
    binary: electronBinary(),
    args: ['.', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`, filePath],
    ready(running) {
      return waitFor(
        running,
        async () => {
          const url = await pageTarget(port);
          if (!url) {
            return null;
          }
          if (!session.client) {
            session.client = openCdp(url);
          }
          const rows = await evaluate(session.client, PREVIEWS);
          if (!rows || rows.length !== expectCount) {
            return null;
          }
          return rows;
        },
        25_000,
      );
    },
  });
  await sleep(200);
  return { session, finish };
}

test('H-22 formula commands show an error and load nothing', { timeout: 90_000 }, async (t) => {
  const doc = await hostileJson('H-22-formula.json');
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const encoded = await encodeObk(doc, emptyManifest(pkg.version));
  assert.equal(encoded.ok, true, JSON.stringify(encoded));
  const file = path.join(await mkdtemp(path.join(tmpdir(), 'obelisk-h22-')), 'hostile.obk');
  await writeFile(file, encoded.bytes);
  const { session, finish } = await launchHostileFile(t, file, 1);
  try {
    const rows = await evaluate(session.client, PREVIEWS);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].error, true);
    assert.equal(rows[0].hasKatex, false);
    assert.equal(rows[0].hasLink, false);
    assert.equal(rows[0].hasImage, false);
  } finally {
    await finish();
  }
});

test('H-23 huge macro shows an error and the next formula is unchanged', { timeout: 90_000 }, async (t) => {
  const doc = await hostileJson('H-23-formula.json');
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const encoded = await encodeObk(doc, emptyManifest(pkg.version));
  assert.equal(encoded.ok, true, JSON.stringify(encoded));
  const file = path.join(await mkdtemp(path.join(tmpdir(), 'obelisk-h23-')), 'hostile.obk');
  await writeFile(file, encoded.bytes);
  const { session, finish } = await launchHostileFile(t, file, 2);
  try {
    const rows = await evaluate(session.client, PREVIEWS);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].error, true);
    assert.equal(rows[1].error, false, rows[1].message);
    assert.equal(rows[1].hasKatex, true);
  } finally {
    await finish();
  }
});