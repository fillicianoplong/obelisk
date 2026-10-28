import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { archiveMessage } from '../../../dist/main/codec/archive/index.js';
import { decodeObk } from '../../../dist/main/codec/decode.js';
import { encodeObk } from '../../../dist/main/codec/encode/index.js';
import { NEWER_VERSION_MESSAGE } from '../../../dist/main/codec/migrate/index.js';
import { PATH_NOT_ALLOWED_MESSAGE } from '../../../dist/main/file/handles.js';
import { OBK_FILTER_NAME, openDialogOptions, pickOpenDialogOwner } from '../../../dist/main/file/openDialog.js';
import { createFileService } from '../../../dist/main/file/service.js';
import { checkUnissuedHandle } from '../../../dist/main/file/unissued.js';
import { createAppHandlers } from '../../../dist/main/ipc/handlers.js';
import { createIpcRegistry } from '../../../dist/main/ipc/registry.js';
import { APP_PAGE_URL } from '../../../dist/shared/app-page.js';
import { emptyManifest, minimalDocument, paragraph, textRun } from '../../../scripts/make-hostile-fixtures/documents.mjs';
import { craftZip, storedEntry } from '../../../scripts/make-hostile-fixtures/zip.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const STAMP = new Date('2020-05-01T12:00:00.000Z');

function documentMessage() {
  return {
    view: 'pageless',
    page: {},
    header: {},
    footer: {},
    blocks: [],
  };
}

function saveArgs(handle, statValue = null) {
  return [{
    handle,
    document: documentMessage(),
    revision: 1,
    expectedStat: statValue,
    replaceConfirmed: false,
  }];
}

async function snapshot(file) {
  const info = await stat(file);
  const bytes = await readFile(file);
  return {
    size: info.size,
    mtimeMs: info.mtimeMs,
    mode: info.mode,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function assertUnchanged(before, after, label) {
  assert.equal(after.size, before.size, label);
  assert.equal(after.mtimeMs, before.mtimeMs, label);
  assert.equal(after.mode, before.mode, label);
  assert.equal(after.sha256, before.sha256, label);
}

async function withDir(check) {
  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-open-'));
  try {
    await check(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('the Open dialog lists only .obk files', async () => {
  const options = openDialogOptions();
  assert.equal(options.title, 'Open');
  assert.deepEqual(options.properties, ['openFile']);
  assert.equal(options.filters.length, 1);
  assert.equal(options.filters[0].name, OBK_FILTER_NAME);
  assert.deepEqual(options.filters[0].extensions, ['obk']);
  assert.equal(JSON.stringify(options).includes('*.*'), false);

  let seen = null;
  const files = createFileService({
    async showOpenDialog(passed) {
      seen = passed;
      return { canceled: true, filePaths: [] };
    },
    readObk() {
      throw new Error('A cancelled dialog must not read a file.');
    },
  });
  const result = await files.openFromDialog();
  assert.deepEqual(result, { status: 'cancelled' });
  assert.deepEqual(seen, options);
  const extensions = seen.filters.flatMap((filter) => filter.extensions);
  assert.deepEqual(extensions, ['obk']);
});

test('the Open dialog is owned by the focused window', () => {
  const gone = { destroyed: true, focused: true, id: 'gone' };
  const other = { destroyed: false, focused: false, id: 'other' };
  const focused = { destroyed: false, focused: true, id: 'focused' };
  assert.equal(pickOpenDialogOwner([gone, other, focused]), focused);
  assert.equal(pickOpenDialogOwner([gone, other]), other);
  assert.equal(pickOpenDialogOwner([gone]), null);
  assert.equal(pickOpenDialogOwner([]), null);
});

test('open decodes through the utility process', async () => {
  const source = await readFile(path.join(root, 'src/main/ipc/install.ts'), 'utf8');
  assert.equal(source.includes('readInUtilityProcess'), true);
  assert.equal(source.includes('decodeObk'), false);
  assert.equal(source.includes('showOpenDialog'), true);
  assert.equal(source.includes('pickOpenDialogOwner'), true);
});

test('a file that fails a check opens nothing and stays unchanged', async () => {
  await withDir(async (directory) => {
    const renamed = path.join(directory, 'renamed.obk');
    await writeFile(renamed, 'this is not an obk');
    await utimes(renamed, STAMP, STAMP);
    const before = await snapshot(renamed);
    const namesBefore = await readdir(directory);

    const files = createFileService({
      showOpenDialog: async () => ({ canceled: false, filePaths: [renamed] }),
      readObk: (filePath) => decodeObk(filePath),
    });
    const result = await files.openFromDialog();
    assert.equal(result.status, 'refused');
    assert.equal(result.reason, 'not-a-zip');
    assert.equal(result.message, 'This file is not an Obelisk archive, so it was not opened.');
    assert.equal(result.message, archiveMessage('not-a-zip'));
    assert.equal(files.handles.handleForPath(renamed), null);
    assertUnchanged(before, await snapshot(renamed), 'renamed');
    assert.deepEqual(await readdir(directory), namesBefore);

    const newer = path.join(directory, 'newer.obk');
    const manifest = { format: 'obelisk', formatVersion: 2, writer: '9.0.0', images: [] };
    const bytes = craftZip({
      entries: [
        storedEntry('manifest.json', Buffer.from(JSON.stringify(manifest))),
        storedEntry('document.json', Buffer.from(JSON.stringify(minimalDocument()))),
      ],
    });
    await writeFile(newer, bytes);
    await utimes(newer, STAMP, STAMP);
    const newerBefore = await snapshot(newer);
    const opened = await files.openPath(newer);
    assert.equal(opened.status, 'refused');
    assert.equal(opened.reason, 'out-of-range');
    assert.equal(opened.message, 'Made by a newer Obelisk; update it from the Microsoft Store');
    assert.equal(opened.message, NEWER_VERSION_MESSAGE);
    assert.equal(files.handles.handleForPath(newer), null);
    assertUnchanged(newerBefore, await snapshot(newer), 'newer');
    assert.deepEqual((await readdir(directory)).sort(), ['newer.obk', 'renamed.obk']);
  });
});

test('a valid file opens with a handle and the file is unchanged', async () => {
  await withDir(async (directory) => {
    const file = path.join(directory, 'Lab notes.obk');
    const encoded = await encodeObk(
      minimalDocument([paragraph(3, [textRun('Lab notes')])]),
      emptyManifest('0.1.23.0'),
    );
    assert.equal(encoded.ok, true);
    await writeFile(file, encoded.bytes);
    await utimes(file, STAMP, STAMP);
    const before = await snapshot(file);
    let reads = 0;
    const files = createFileService({
      showOpenDialog: async () => ({ canceled: false, filePaths: [file] }),
      readObk(filePath) {
        reads += 1;
        return decodeObk(filePath);
      },
    });

    const result = await files.openFromDialog();
    assert.equal(result.status, 'ok');
    assert.match(result.handle, /^[a-f0-9]{32}$/);
    assert.equal(result.name, 'Lab notes.obk');
    assert.equal(result.document.view, 'pageless');
    assert.equal(result.document.blocks[0].content[0].text, 'Lab notes');
    assert.equal(result.stat.size, before.size);
    assert.equal(Object.hasOwn(result, 'path'), false);
    assert.equal(JSON.stringify(result).includes(file), false);
    assert.equal(reads, 1);

    const again = await files.openFromDialog();
    assert.deepEqual(again, { status: 'alreadyOpen', tabId: result.handle });
    assert.equal(reads, 1);
    assertUnchanged(before, await snapshot(file), 'opened');

    const registry = createIpcRegistry(createAppHandlers(files));
    const saved = await registry.dispatch({
      senderUrl: APP_PAGE_URL,
      channel: 'file:save',
      args: saveArgs(result.handle, result.stat),
    });
    assert.equal(saved.status, 'error');
    assert.equal(saved.code, 'ENCODE_FAILED');
    assert.equal(saved.message, 'This document is not valid, so it was not saved.');
    assertUnchanged(before, await snapshot(file), 'invalid document was not written');
    assert.deepEqual(await readdir(directory), ['Lab notes.obk']);
  });
});

test('a relative path is refused and nothing is read', async () => {
  let reads = 0;
  const files = createFileService({
    showOpenDialog: async () => ({ canceled: false, filePaths: ['notes.obk'] }),
    readObk() {
      reads += 1;
      throw new Error('A relative path must not be read.');
    },
  });
  const result = await files.openFromDialog();
  assert.equal(result.status, 'refused');
  assert.equal(result.reason, 'not-a-file');
  assert.equal(result.message, archiveMessage('not-a-file'));
  assert.equal(reads, 0);
});

test('a handle main did not issue returns PATH_NOT_ALLOWED and touches nothing', async () => {
  await withDir(async (directory) => {
    const sentinel = path.join(directory, 'sentinel.obk');
    await writeFile(sentinel, 'leave me alone');
    await utimes(sentinel, STAMP, STAMP);
    const before = await snapshot(sentinel);
    const names = await readdir(directory);

    const checked = await checkUnissuedHandle({
      channel: 'file:save',
      handle: 'not-issued-by-main',
    });
    assert.deepEqual(checked, { ok: false, reason: 'PATH_NOT_ALLOWED', path: '' });

    const files = createFileService({
      showOpenDialog() {
        throw new Error('The Open dialog ran for an unknown handle.');
      },
      readObk() {
        throw new Error('A file was read for an unknown handle.');
      },
    });
    const registry = createIpcRegistry(createAppHandlers(files));
    const saved = await registry.dispatch({
      senderUrl: APP_PAGE_URL,
      channel: 'file:save',
      args: saveArgs('not-issued-by-main'),
    });
    assert.deepEqual(saved, {
      status: 'error',
      code: 'PATH_NOT_ALLOWED',
      message: PATH_NOT_ALLOWED_MESSAGE,
      retryable: false,
    });
    assert.equal(JSON.stringify(saved).includes(sentinel), false);

    const saveAs = await registry.dispatch({
      senderUrl: APP_PAGE_URL,
      channel: 'file:saveAs',
      args: [{ handle: 'not-issued-by-main', document: documentMessage(), revision: 1 }],
    });
    assert.equal(saveAs.code, 'PATH_NOT_ALLOWED');

    const exported = await registry.dispatch({
      senderUrl: APP_PAGE_URL,
      channel: 'export:run',
      args: [{
        format: 'pdf',
        handle: 'not-issued-by-main',
        document: documentMessage(),
        assets: { mathml: [], formulaPngs: [], firstFramePngs: [] },
      }],
    });
    assert.equal(exported.code, 'PATH_NOT_ALLOWED');

    const session = await registry.dispatch({
      senderUrl: APP_PAGE_URL,
      channel: 'session:set',
      args: [{ handles: ['not-issued-by-main'], activeHandle: 'not-issued-by-main' }],
    });
    assert.equal(session.code, 'PATH_NOT_ALLOWED');

    assertUnchanged(before, await snapshot(sentinel), 'sentinel');
    assert.deepEqual(await readdir(directory), names);
  });
});

test('forgetting a closed handle does not write the file', async () => {
  await withDir(async (directory) => {
    const file = path.join(directory, 'notes.obk');
    const encoded = await encodeObk(minimalDocument(), emptyManifest('0.1.23.0'));
    assert.equal(encoded.ok, true);
    await writeFile(file, encoded.bytes);
    await utimes(file, STAMP, STAMP);
    const before = await snapshot(file);
    const files = createFileService({
      showOpenDialog: async () => ({ canceled: false, filePaths: [file] }),
      readObk: (filePath) => decodeObk(filePath),
    });
    const opened = await files.openFromDialog();
    assert.equal(opened.status, 'ok');

    const kept = files.retainOpenHandles(['not-issued-by-main']);
    assert.equal(kept.code, 'PATH_NOT_ALLOWED');
    const still = await files.openPath(file);
    assert.deepEqual(still, { status: 'alreadyOpen', tabId: opened.handle });

    const released = files.retainOpenHandles([]);
    assert.deepEqual(released, { status: 'ok' });
    const reopened = await files.openPath(file);
    assert.equal(reopened.status, 'ok');
    assert.notEqual(reopened.handle, opened.handle);
    assertUnchanged(before, await snapshot(file), 'retained');
    assert.deepEqual(await readdir(directory), ['notes.obk']);
  });
});
