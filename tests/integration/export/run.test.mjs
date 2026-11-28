import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { decodeObk } from '../../../dist/main/codec/decode.js';
import { encodeObk } from '../../../dist/main/codec/encode/index.js';
import { createExportService } from '../../../dist/main/export/service.js';
import { EXPORT_DIALOG_TITLE } from '../../../dist/main/export/dialog.js';
import { createFileService } from '../../../dist/main/file/service.js';
import { createAppHandlers } from '../../../dist/main/ipc/handlers.js';
import { createStubRecoveryService } from '../../../dist/main/recovery/stub.js';
import { createIpcRegistry } from '../../../dist/main/ipc/registry.js';
import { APP_PAGE_URL } from '../../../dist/shared/app-page.js';
import { emptyManifest, minimalDocument, paragraph, textRun } from '../../../scripts/make-hostile-fixtures/documents.mjs';

const WRITER = '0.1.51.0';
const STAMP = new Date('2020-05-01T12:00:00.000Z');

function document(text) {
  return minimalDocument([paragraph(3, [textRun(text)])]);
}

function documentMessage() {
  return {
    view: 'pageless',
    page: {},
    header: {},
    footer: {},
    blocks: [],
  };
}

async function snapshot(file) {
  const info = await stat(file);
  const bytes = await readFile(file);
  return {
    size: info.size,
    mtimeMs: info.mtimeMs,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function assertUnchanged(before, after, label) {
  assert.equal(after.size, before.size, label);
  assert.equal(after.mtimeMs, before.mtimeMs, label);
  assert.equal(after.sha256, before.sha256, label);
}

async function withDir(check) {
  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-export-ipc-'));
  try {
    await check(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function writeObk(file, text) {
  const encoded = await encodeObk(document(text), emptyManifest(WRITER));
  assert.equal(encoded.ok, true);
  await writeFile(file, encoded.bytes);
  await utimes(file, STAMP, STAMP);
}

function harness(directory, extras = {}) {
  const calls = { exportDialog: [], replace: [] };
  const files = createFileService({
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    readObk: (filePath) => decodeObk(filePath),
    documentsDirectory: () => directory,
    writer: WRITER,
    platform: extras.platform ?? 'linux',
    showSaveDialog: async () => ({ canceled: true, filePath: '' }),
    confirmReplace: async (options) => {
      calls.replace.push(options);
      return extras.replace ? extras.replace(options) : false;
    },
  });
  const exports = createExportService({
    showExportDialog: async (options) => {
      calls.exportDialog.push(options);
      return extras.exportDialog(options);
    },
    confirmReplace: async (options) => {
      calls.replace.push(options);
      return extras.replace ? extras.replace(options) : false;
    },
    lookupHandle: (handle) => files.handles.lookup(handle),
    documentsDirectory: () => directory,
    platform: extras.platform ?? 'linux',
    atomic: extras.atomic,
    exportTimeoutMs: extras.exportTimeoutMs,
  });
  return { files, calls, registry: createIpcRegistry(createAppHandlers(files, exports, createStubRecoveryService())) };
}

test('export dialog options name each format and export leaves the .obk unchanged', async () => {
  await withDir(async (directory) => {
    const obk = path.join(directory, 'Lesson.obk');
    const exportTarget = path.join(directory, 'Lesson.pdf');
    await writeObk(obk, 'export me');
    const before = await snapshot(obk);
    const { files, calls, registry } = harness(directory, {
      exportDialog: () => ({ canceled: false, filePath: exportTarget }),
    });
    const opened = await files.openPath(obk);
    assert.equal(opened.status, 'ok');
    const exported = await registry.dispatch({
      senderUrl: APP_PAGE_URL,
      channel: 'export:run',
      args: [{
        format: 'pdf',
        handle: opened.handle,
        document: documentMessage(),
        assets: { mathml: [], formulaPngs: [], firstFramePngs: [] },
      }],
    });
    assert.equal(exported.status, 'ok');
    assert.equal(exported.name, 'Lesson.pdf');
    assert.equal(calls.exportDialog.length, 1);
    assert.equal(calls.exportDialog[0].title, EXPORT_DIALOG_TITLE);
    assert.deepEqual(calls.exportDialog[0].filters[0].extensions, ['pdf']);
    assertUnchanged(before, await snapshot(obk), 'source obk');
    const written = await readFile(exportTarget, 'utf8');
    assert.match(written, /^%PDF/);
  });
});

test('Cancel at export replace leaves the existing file unchanged', async () => {
  await withDir(async (directory) => {
    const obk = path.join(directory, 'Notes.obk');
    const existing = path.join(directory, 'Notes.pdf');
    await writeObk(obk, 'notes');
    await writeFile(existing, 'keep this pdf');
    const before = await snapshot(existing);
    const { files, registry } = harness(directory, {
      exportDialog: () => ({ canceled: false, filePath: existing }),
      replace: () => false,
    });
    const opened = await files.openPath(obk);
    assert.equal(opened.status, 'ok');
    const exported = await registry.dispatch({
      senderUrl: APP_PAGE_URL,
      channel: 'export:run',
      args: [{
        format: 'pdf',
        handle: opened.handle,
        document: documentMessage(),
        assets: { mathml: [], formulaPngs: [], firstFramePngs: [] },
      }],
    });
    assert.equal(exported.status, 'cancelled');
    assertUnchanged(before, await snapshot(existing), 'existing export');
    assert.deepEqual(await readdir(directory).then((names) => names.sort()), ['Notes.obk', 'Notes.pdf']);
  });
});