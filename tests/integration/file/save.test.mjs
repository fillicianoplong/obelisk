import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { decodeObk } from '../../../dist/main/codec/decode.js';
import { encodeObk } from '../../../dist/main/codec/encode/index.js';
import { PATH_NOT_ALLOWED_MESSAGE } from '../../../dist/main/file/handles.js';
import { OBK_FILTER_NAME } from '../../../dist/main/file/openDialog.js';
import {
  REPLACE_PROMPT_MESSAGE,
  SAVE_DIALOG_TITLE,
  UNTITLED_FILE_NAME,
  replacePromptOptions,
  saveDialogOptions,
} from '../../../dist/main/file/saveDialog.js';
import { createFileService } from '../../../dist/main/file/service.js';
import { createAppHandlers } from '../../../dist/main/ipc/handlers.js';
import { createIpcRegistry } from '../../../dist/main/ipc/registry.js';
import { APP_PAGE_URL } from '../../../dist/shared/app-page.js';
import { emptyManifest, minimalDocument, paragraph, textRun } from '../../../scripts/make-hostile-fixtures/documents.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const WRITER = '0.1.24.0';
const STAMP = new Date('2020-05-01T12:00:00.000Z');
const LATER = new Date('2020-06-01T12:00:00.000Z');
const TIMEOUT_MESSAGE = 'The save did not finish within 5 seconds, so it was not saved.';

function document(text) {
  return minimalDocument([paragraph(3, [textRun(text)])]);
}

function saveBody(handle, doc, fileStat, replaceConfirmed = false) {
  return {
    handle,
    document: doc,
    revision: 4,
    expectedStat: fileStat,
    replaceConfirmed,
  };
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
  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-save-'));
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

function service(directory, extras = {}) {
  const calls = { save: [], replace: [] };
  const files = createFileService({
    showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
    readObk: (filePath) => decodeObk(filePath),
    documentsDirectory: () => directory,
    writer: WRITER,
    platform: extras.platform ?? 'linux',
    showSaveDialog: async (options) => {
      calls.save.push(options);
      return extras.saveDialog(options);
    },
    confirmReplace: async (options) => {
      calls.replace.push(options);
      return extras.replace ? extras.replace(options) : false;
    },
    atomic: extras.atomic,
  });
  return { files, calls };
}

async function openFile(files, file) {
  const opened = await files.openPath(file);
  assert.equal(opened.status, 'ok');
  return opened;
}

function registry(files) {
  return createIpcRegistry(createAppHandlers(files));
}

async function dispatch(files, channel, args) {
  return registry(files).dispatch({
    senderUrl: APP_PAGE_URL,
    channel,
    args,
  });
}

function clock() {
  let time = 0;
  return {
    now() {
      return time;
    },
    async sleep(ms, signal) {
      if (signal?.aborted) {
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      }
      await new Promise((resolve) => {
        setImmediate(resolve);
      });
      if (signal?.aborted) {
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      }
      time += ms;
    },
  };
}

test('the Save dialog asks for an Obelisk document and is owned by the window', async () => {
  const options = saveDialogOptions('/docs/Untitled.obk');
  assert.equal(options.title, SAVE_DIALOG_TITLE);
  assert.equal(options.defaultPath, '/docs/Untitled.obk');
  assert.equal(options.filters.length, 1);
  assert.equal(options.filters[0].name, OBK_FILTER_NAME);
  assert.deepEqual(options.filters[0].extensions, ['obk']);
  assert.equal(Object.hasOwn(options, 'properties'), false);
  assert.equal(JSON.stringify(options).includes('*.*'), false);

  const prompt = replacePromptOptions();
  assert.equal(prompt.message, REPLACE_PROMPT_MESSAGE);
  assert.equal(prompt.message, 'A file with that name exists.');
  assert.deepEqual(prompt.buttons, ['Replace', 'Cancel']);
  assert.equal(prompt.cancelId, 1);

  const source = await readFile(path.join(root, 'src/main/ipc/install.ts'), 'utf8');
  assert.equal(source.includes('showSaveDialog'), true);
  assert.equal(source.includes('pickOpenDialogOwner'), true);
  assert.equal(source.includes('dialog.showSaveDialog(owner.window, options)'), true);
  assert.equal(source.includes('writeFile'), false);
  assert.equal(source.includes('encodeObk'), false);
});

test('a saved tab writes on Save and reopens with the same content', async () => {
  await withDir(async (directory) => {
    const file = path.join(directory, 'Lab notes.obk');
    await writeObk(file, 'Lab notes');
    const { files } = service(directory);
    const opened = await openFile(files, file);
    const next = document('Lab notes and a diagram');
    const saved = await dispatch(files, 'file:save', [saveBody(opened.handle, next, opened.stat)]);
    assert.equal(saved.status, 'ok');
    assert.equal(saved.revision, 4);
    assert.equal(JSON.stringify(saved).includes(directory), false);

    const again = await dispatch(files, 'file:save', [saveBody(opened.handle, next, saved.stat)]);
    assert.equal(again.status, 'ok');

    const reopened = await files.openPath(file);
    assert.equal(reopened.status, 'alreadyOpen');
    files.retainOpenHandles([]);
    const fresh = await files.openPath(file);
    assert.equal(fresh.status, 'ok');
    assert.equal(fresh.document.blocks[0].content[0].text, 'Lab notes and a diagram');
    assert.equal(fresh.document.view, 'pageless');
    assert.equal(fresh.stat.size, again.stat.size);
    assert.equal(fresh.stat.modifiedMs, again.stat.modifiedMs);
  });
});

test('the first Save asks for a folder and a name', async () => {
  await withDir(async (directory) => {
    const target = path.join(directory, 'Lesson.obk');
    let dialogs = 0;
    const { files, calls } = service(directory, {
      saveDialog() {
        dialogs += 1;
        return { canceled: false, filePath: target };
      },
    });
    const saved = await dispatch(files, 'file:saveAs', [{
      handle: null,
      document: document('first save'),
      revision: 2,
    }]);
    assert.equal(dialogs, 1);
    assert.equal(calls.save.length, 1);
    assert.equal(calls.save[0].title, 'Save as');
    assert.equal(calls.save[0].filters[0].name, 'Obelisk document');
    assert.deepEqual(calls.save[0].filters[0].extensions, ['obk']);
    assert.equal(calls.save[0].defaultPath, path.join(directory, UNTITLED_FILE_NAME));
    assert.equal(saved.status, 'ok');
    assert.equal(saved.name, 'Lesson.obk');
    assert.match(saved.handle, /^[a-f0-9]{32}$/);
    assert.equal(saved.revision, 2);
    const fresh = await files.openPath(target);
    assert.equal(fresh.status, 'alreadyOpen');
    files.retainOpenHandles([]);
    const reopened = await files.openPath(target);
    assert.equal(reopened.document.blocks[0].content[0].text, 'first save');
  });
});

test('Save as to a new name leaves the old file untouched', async () => {
  await withDir(async (directory) => {
    const original = path.join(directory, 'Lab notes.obk');
    const copy = path.join(directory, 'Lab notes copy.obk');
    await writeObk(original, 'keep me');
    const before = await snapshot(original);
    const { files } = service(directory, {
      saveDialog: () => ({ canceled: false, filePath: copy }),
    });
    const opened = await openFile(files, original);
    const saved = await dispatch(files, 'file:saveAs', [{
      handle: opened.handle,
      document: document('the copy'),
      revision: 4,
    }]);
    assert.equal(saved.status, 'ok');
    assert.equal(saved.name, 'Lab notes copy.obk');
    assert.notEqual(saved.handle, opened.handle);
    assertUnchanged(before, await snapshot(original), 'old file');
    assert.equal(files.handles.lookup(opened.handle), null);

    files.retainOpenHandles([]);
    const old = await files.openPath(original);
    const next = await files.openPath(copy);
    assert.equal(old.status, 'ok');
    assert.equal(old.document.blocks[0].content[0].text, 'keep me');
    assert.equal(next.status, 'ok');
    assert.equal(next.document.blocks[0].content[0].text, 'the copy');
    assert.notEqual(old.handle, next.handle);
  });
});

test('Cancel at the replace prompt leaves the existing file unchanged', async () => {
  await withDir(async (directory) => {
    const existing = path.join(directory, 'Taken.obk');
    await writeObk(existing, 'already here');
    const before = await snapshot(existing);
    const names = await readdir(directory);

    const cancelled = service(directory, {
      saveDialog: () => ({ canceled: true, filePath: '' }),
    });
    const fromDialog = await dispatch(cancelled.files, 'file:saveAs', [{
      handle: null,
      document: document('should not land'),
      revision: 1,
    }]);
    assert.deepEqual(fromDialog, { status: 'cancelled' });
    assert.equal(cancelled.calls.replace.length, 0);
    assertUnchanged(before, await snapshot(existing), 'dialog cancel');
    assert.deepEqual(await readdir(directory), names);

    const prompted = service(directory, {
      platform: 'linux',
      saveDialog: () => ({ canceled: false, filePath: existing }),
      replace: () => false,
    });
    const fromPrompt = await dispatch(prompted.files, 'file:saveAs', [{
      handle: null,
      document: document('should not land'),
      revision: 1,
    }]);
    assert.deepEqual(fromPrompt, { status: 'cancelled' });
    assert.equal(prompted.calls.replace.length, 1);
    assert.equal(prompted.calls.replace[0].message, 'A file with that name exists.');
    assert.deepEqual(prompted.calls.replace[0].buttons, ['Replace', 'Cancel']);
    assertUnchanged(before, await snapshot(existing), 'prompt cancel');
    assert.deepEqual(await readdir(directory), names);
  });
});

test('Windows uses the Save dialog as the replace prompt and does not ask again', async () => {
  await withDir(async (directory) => {
    const existing = path.join(directory, 'Taken.obk');
    await writeObk(existing, 'old bytes');
    const { files, calls } = service(directory, {
      platform: 'win32',
      saveDialog: () => ({ canceled: false, filePath: existing }),
      replace: () => {
        throw new Error('Windows asked a second time.');
      },
    });
    const saved = await dispatch(files, 'file:saveAs', [{
      handle: null,
      document: document('replaced'),
      revision: 3,
    }]);
    assert.equal(saved.status, 'ok');
    assert.equal(calls.replace.length, 0);
    files.retainOpenHandles([]);
    const reopened = await files.openPath(existing);
    assert.equal(reopened.document.blocks[0].content[0].text, 'replaced');
  });
});

test('a file changed in another program asks before anything is written', async () => {
  await withDir(async (directory) => {
    const file = path.join(directory, 'Notes.obk');
    await writeObk(file, 'obelisk');
    const { files } = service(directory);
    const opened = await openFile(files, file);
    const notepad = Buffer.from('edited in notepad');
    await writeFile(file, notepad);
    await utimes(file, LATER, LATER);
    const changed = await snapshot(file);
    const names = await readdir(directory);

    const saved = await dispatch(files, 'file:save', [saveBody(opened.handle, document('obelisk again'), opened.stat)]);
    assert.equal(saved.status, 'conflict');
    assert.equal(saved.stat.size, changed.size);
    assert.equal(saved.stat.modifiedMs, Math.trunc(changed.mtimeMs));
    assertUnchanged(changed, await snapshot(file), 'conflict wrote nothing');
    assert.deepEqual(await readdir(directory), names);

    const overwrite = await dispatch(files, 'file:save', [
      saveBody(opened.handle, document('obelisk again'), saved.stat, true),
    ]);
    assert.equal(overwrite.status, 'ok');
    files.retainOpenHandles([]);
    const reopened = await files.openPath(file);
    assert.equal(reopened.document.blocks[0].content[0].text, 'obelisk again');
  });
});

test('a save that does not finish within 5 seconds leaves the file unchanged', async () => {
  await withDir(async (directory) => {
    const file = path.join(directory, 'Slow.obk');
    await writeObk(file, 'still here');
    const before = await snapshot(file);
    const names = await readdir(directory);
    const timer = clock();
    const { files } = service(directory, {
      atomic: {
        now: () => timer.now(),
        sleep: (ms, signal) => timer.sleep(ms, signal),
        fs: {
          async open() {
            await new Promise(() => {});
          },
          async rename() {
            throw new Error('A timed-out save renamed the file.');
          },
          async unlink() {},
          async stat() {
            throw Object.assign(new Error('missing'), { code: 'ENOENT' });
          },
          async readdir() {
            return [];
          },
        },
      },
    });
    const opened = await openFile(files, file);
    const saved = await dispatch(files, 'file:save', [saveBody(opened.handle, document('too late'), opened.stat)]);
    assert.equal(saved.status, 'timeout');
    assert.equal(saved.code, 'TIMEOUT');
    assert.equal(saved.message, TIMEOUT_MESSAGE);
    assert.equal(saved.retryable, true);
    assertUnchanged(before, await snapshot(file), 'timeout');
    assert.deepEqual(await readdir(directory), names);
    assert.equal(files.handles.lookup(opened.handle).stat.size, opened.stat.size);
    assert.equal(files.handles.lookup(opened.handle).stat.modifiedMs, opened.stat.modifiedMs);
  });
});

test('an unknown handle returns PATH_NOT_ALLOWED and touches nothing', async () => {
  await withDir(async (directory) => {
    const sentinel = path.join(directory, 'sentinel.obk');
    await writeFile(sentinel, 'leave me alone');
    await utimes(sentinel, STAMP, STAMP);
    const before = await snapshot(sentinel);
    const names = await readdir(directory);
    let dialogs = 0;
    const { files } = service(directory, {
      saveDialog() {
        dialogs += 1;
        return { canceled: true };
      },
    });
    const saved = await dispatch(files, 'file:save', [saveBody('not-issued-by-main', document('no'), null)]);
    assert.equal(saved.code, 'PATH_NOT_ALLOWED');
    assert.equal(saved.message, PATH_NOT_ALLOWED_MESSAGE);
    const saveAs = await dispatch(files, 'file:saveAs', [{
      handle: 'not-issued-by-main',
      document: document('no'),
      revision: 1,
    }]);
    assert.equal(saveAs.code, 'PATH_NOT_ALLOWED');
    assert.equal(dialogs, 0);
    assertUnchanged(before, await snapshot(sentinel), 'sentinel');
    assert.deepEqual(await readdir(directory), names);
  });
});

test('a name without .obk is saved as .obk, and a relative path is refused', async () => {
  await withDir(async (directory) => {
    const stem = path.join(directory, 'Lesson');
    const { files } = service(directory, {
      saveDialog: () => ({ canceled: false, filePath: stem }),
    });
    const saved = await dispatch(files, 'file:saveAs', [{
      handle: null,
      document: document('named'),
      revision: 1,
    }]);
    assert.equal(saved.status, 'ok');
    assert.equal(saved.name, 'Lesson.obk');
    const bytes = await readFile(`${stem}.obk`);
    assert.equal(bytes.length > 0, true);
    assert.equal(await readdir(directory).then((names) => names.includes('Lesson')), false);

    const relative = service(directory, {
      saveDialog: () => ({ canceled: false, filePath: 'notes.obk' }),
    });
    const refused = await dispatch(relative.files, 'file:saveAs', [{
      handle: null,
      document: document('no'),
      revision: 1,
    }]);
    assert.equal(refused.code, 'PATH_NOT_ALLOWED');
    assert.deepEqual(await readdir(directory), ['Lesson.obk']);
  });
});
