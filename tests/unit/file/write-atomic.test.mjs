import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const moduleUrl = pathToFileURL(path.join(root, 'dist/main/file/writeAtomic.js')).href;

const {
  RENAME_ATTEMPTS,
  RENAME_RETRY_MS,
  SAVE_TIMEOUT_MS,
  TEMP_FILE_PATTERN,
  TEMP_MAX_AGE_MS,
  defaultDocumentDirectory,
  isPrivateDocumentPath,
  removeStaleTempFiles,
  saveClearedUnsavedMark,
  tempFileName,
  writeAtomic,
} = await import(moduleUrl);

const OLD = Buffer.from('previous paper');
const NEXT = Buffer.from('complete new paper');

function codeError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createClock(start = 0) {
  let time = start;
  const completed = [];
  return {
    now() {
      return time;
    },
    async sleep(ms, signal) {
      if (signal?.aborted) {
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      }
      // After the current microtasks, so a finished step can cancel this wait.
      await new Promise((resolve) => {
        setImmediate(resolve);
      });
      if (signal?.aborted) {
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      }
      time += ms;
      completed.push(ms);
    },
    advance(ms) {
      time += ms;
    },
    completed,
  };
}

function createFakeFs(seed = {}) {
  const pathApi = seed.pathApi ?? path;
  const files = new Map();
  const calls = [];
  let renameFailures = [...(seed.renameFailures ?? [])];
  const alwaysRename = seed.alwaysRename ?? null;

  function key(file) {
    return pathApi.normalize(file);
  }

  function put(file, entry) {
    files.set(key(file), {
      data: Buffer.from(entry.data ?? Buffer.alloc(0)),
      mode: entry.mode ?? 0o666,
      mtimeMs: entry.mtimeMs ?? 0,
      isFile: entry.isFile !== false,
    });
  }

  for (const [file, entry] of Object.entries(seed.files ?? {})) {
    put(file, entry);
  }

  return {
    calls,
    put,
    get(file) {
      return files.get(key(file));
    },
    async open(file, flags) {
      calls.push(['open', file, flags]);
      if (seed.openError) {
        throw codeError(seed.openError);
      }
      const existing = files.get(key(file));
      if (flags.includes('x') && existing) {
        throw codeError('EEXIST');
      }
      if (!existing) {
        put(file, { data: Buffer.alloc(0), mtimeMs: 0 });
      }
      let stalled = false;
      return {
        async write(data) {
          calls.push(['write', file, data.byteLength]);
          if (seed.stallWrite) {
            stalled = true;
            return new Promise(() => {});
          }
          if (seed.writeError) {
            throw codeError(seed.writeError);
          }
          if (seed.shortWrite) {
            return { bytesWritten: 0 };
          }
          const current = files.get(key(file));
          const chunk = Buffer.from(data);
          current.data = Buffer.concat([current.data, chunk]);
          if (seed.onWrite) {
            seed.onWrite(current);
          }
          return { bytesWritten: chunk.byteLength };
        },
        async sync() {
          calls.push(['sync', file]);
          if (seed.stallSync) {
            return new Promise(() => {});
          }
        },
        async close() {
          calls.push(['close', file, stalled]);
        },
      };
    },
    async rename(from, to) {
      calls.push(['rename', from, to]);
      if (seed.rename) {
        return seed.rename(from, to, { files, key, put });
      }
      const failure = alwaysRename ?? renameFailures.shift();
      if (failure) {
        throw codeError(failure);
      }
      const source = files.get(key(from));
      if (!source) {
        throw codeError('ENOENT');
      }
      put(to, {
        data: Buffer.from(source.data),
        mode: source.mode,
        mtimeMs: source.mtimeMs,
        isFile: source.isFile,
      });
      files.delete(key(from));
    },
    async unlink(file) {
      calls.push(['unlink', file]);
      if (!files.delete(key(file))) {
        throw codeError('ENOENT');
      }
    },
    async stat(file) {
      calls.push(['stat', file]);
      const entry = files.get(key(file));
      if (!entry) {
        throw codeError('ENOENT');
      }
      return {
        size: entry.data.length,
        mtimeMs: entry.mtimeMs,
        mode: entry.mode,
        isFile: () => entry.isFile,
      };
    },
    async readdir(directory) {
      calls.push(['readdir', directory]);
      if (seed.readdirError) {
        throw codeError(seed.readdirError);
      }
      const dir = key(directory);
      const names = [];
      for (const file of files.keys()) {
        if (pathApi.dirname(file) === dir) {
          names.push(pathApi.basename(file));
        }
      }
      return names;
    },
  };
}

function folderFixture(extra = {}) {
  const dir = path.join('save-root', 'folder');
  const target = path.join(dir, 'paper.obk');
  const files = {
    [target]: { data: OLD, mode: 0o666, mtimeMs: 0 },
    ...(extra.files ?? {}),
  };
  const fs = createFakeFs({ ...extra, files });
  return { dir, target, fs };
}

function renamed(fs) {
  return fs.calls.filter((call) => call[0] === 'rename');
}

function unlinked(fs) {
  return fs.calls.filter((call) => call[0] === 'unlink').map((call) => path.basename(call[1]));
}

test('the save contract constants match the architecture', () => {
  assert.equal(SAVE_TIMEOUT_MS, 5000);
  assert.equal(RENAME_ATTEMPTS, 3);
  assert.equal(RENAME_RETRY_MS, 100);
  assert.equal(TEMP_MAX_AGE_MS, 10 * 60 * 1000);
  const name = tempFileName(Buffer.alloc(16, 0xab));
  assert.equal(TEMP_FILE_PATTERN.test(name), true);
  assert.equal(name, `.~obk-${'ab'.repeat(16)}.tmp`);
});

test('a save replaces the target only when the rename finishes', async () => {
  const { target, fs } = folderFixture();
  let release;
  let moved = false;
  fs.rename = async (from, to) => {
    fs.calls.push(['rename', from, to]);
    await new Promise((resolve) => {
      release = resolve;
    });
    const source = fs.get(from);
    fs.put(to, { data: Buffer.from(source.data), mode: source.mode, mtimeMs: 40, isFile: true });
    moved = true;
  };
  // The fake records rename, then the original map still has to drop the temp.
  const pending = writeAtomic(target, NEXT, { fs });
  const started = Date.now();
  while (!release) {
    if (Date.now() - started > 2000) {
      throw new Error('The rename did not start.');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  let settled = false;
  pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(moved, false);
  assert.equal(Buffer.compare(fs.get(target).data, OLD), 0);
  assert.equal(saveClearedUnsavedMark({ status: 'timeout', code: 'TIMEOUT', message: '', retryable: true }, true), false);

  release();
  const result = await pending;
  assert.equal(result.status, 'ok');
  assert.equal(result.stat.size, NEXT.length);
  assert.equal(Buffer.compare(fs.get(target).data, NEXT), 0);
  assert.equal(saveClearedUnsavedMark(result, true), true);
  assert.equal(saveClearedUnsavedMark(result, false), false);
  assert.equal(fs.calls.some((call) => call[0] === 'open' && call[2] === 'wx'), true);
  const order = fs.calls.map((call) => call[0]);
  assert.ok(order.indexOf('sync') < order.indexOf('close'));
  assert.ok(order.indexOf('close') < order.indexOf('rename'));
});

test('a locked rename is tried 3 times, 100 ms apart, then reports the error', async () => {
  for (const code of ['EBUSY', 'EPERM', 'EACCES']) {
    const clock = createClock();
    const { target, fs } = folderFixture({ alwaysRename: code });
    const result = await writeAtomic(target, NEXT, { fs, now: clock.now, sleep: clock.sleep });
    assert.equal(result.status, 'error', code);
    assert.equal(result.code, 'EBUSY_EXHAUSTED', code);
    assert.equal(result.retryable, true, code);
    assert.match(result.message, /another program has this file open/i, code);
    assert.equal(renamed(fs).length, 3, code);
    assert.deepEqual(clock.completed, [100, 100], code);
    assert.equal(Buffer.compare(fs.get(target).data, OLD), 0, code);
    assert.equal(unlinked(fs).every((name) => TEMP_FILE_PATTERN.test(name)), true, code);
    assert.equal(saveClearedUnsavedMark(result, true), false, code);
  }
});

test('a read-only target is reported without using up the lock retries', async () => {
  const clock = createClock();
  const { target, fs } = folderFixture({ alwaysRename: 'EPERM' });
  fs.get(target).mode = 0o444;
  const result = await writeAtomic(target, NEXT, { fs, now: clock.now, sleep: clock.sleep });
  assert.equal(result.status, 'error');
  assert.equal(result.code, 'EACCES');
  assert.equal(result.retryable, false);
  assert.match(result.message, /read-only/i);
  assert.equal(renamed(fs).length, 1);
  assert.deepEqual(clock.completed, []);
  assert.equal(Buffer.compare(fs.get(target).data, OLD), 0);
  assert.equal(unlinked(fs).length, 1);
});

test('a write that stalls stops at 5 seconds and leaves the target unchanged', async () => {
  const clock = createClock();
  const { target, fs } = folderFixture({ stallWrite: true });
  const result = await writeAtomic(target, NEXT, { fs, now: clock.now, sleep: clock.sleep });
  assert.equal(result.status, 'timeout');
  assert.equal(result.code, 'TIMEOUT');
  assert.equal(result.retryable, true);
  assert.match(result.message, /5 seconds/);
  assert.deepEqual(clock.completed, [5000]);
  assert.equal(renamed(fs).length, 0);
  assert.equal(Buffer.compare(fs.get(target).data, OLD), 0);
  assert.equal(unlinked(fs).length, 1);
  assert.equal(saveClearedUnsavedMark(result, true), false);
});

test('a real timer stops a stalled write at the deadline', async () => {
  const { target, fs } = folderFixture({ stallWrite: true });
  const result = await writeAtomic(target, NEXT, { fs, timeoutMs: 40 });
  assert.equal(result.status, 'timeout');
  assert.equal(renamed(fs).length, 0);
  assert.equal(Buffer.compare(fs.get(target).data, OLD), 0);
});

test('a write that finishes on the deadline does not rename', async () => {
  const clock = createClock();
  const { target, fs } = folderFixture({
    onWrite(entry) {
      entry.data = Buffer.from(NEXT);
      clock.advance(SAVE_TIMEOUT_MS);
    },
  });
  const result = await writeAtomic(target, NEXT, { fs, now: clock.now, sleep: clock.sleep });
  assert.equal(result.status, 'timeout');
  assert.equal(renamed(fs).length, 0);
  assert.equal(Buffer.compare(fs.get(target).data, OLD), 0);
});

test('a rename that has started finishes and is reported as saved', async () => {
  const clock = createClock();
  const { target, fs } = folderFixture({
    onWrite(entry) {
      clock.advance(SAVE_TIMEOUT_MS - 1);
      entry.data = Buffer.from(NEXT);
    },
  });
  const originalRename = fs.rename.bind(fs);
  fs.rename = async (from, to) => {
    clock.advance(50);
    return originalRename(from, to);
  };
  const result = await writeAtomic(target, NEXT, { fs, now: clock.now, sleep: clock.sleep });
  assert.equal(result.status, 'ok');
  assert.ok(clock.now() > SAVE_TIMEOUT_MS);
  assert.equal(Buffer.compare(fs.get(target).data, NEXT), 0);
  assert.equal(saveClearedUnsavedMark(result, true), true);
});

test('a full disk leaves the previous file in place', async () => {
  const { target, fs } = folderFixture({ writeError: 'ENOSPC' });
  const result = await writeAtomic(target, NEXT, { fs });
  assert.equal(result.status, 'error');
  assert.equal(result.code, 'ENOSPC');
  assert.equal(result.retryable, true);
  assert.match(result.message, /disk is full/i);
  assert.equal(renamed(fs).length, 0);
  assert.equal(Buffer.compare(fs.get(target).data, OLD), 0);
  assert.equal(unlinked(fs).length, 1);
});

test('a short write is a full disk and does not rename', async () => {
  const { target, fs } = folderFixture({ shortWrite: true });
  const result = await writeAtomic(target, NEXT, { fs });
  assert.equal(result.code, 'ENOSPC');
  assert.equal(renamed(fs).length, 0);
  assert.equal(Buffer.compare(fs.get(target).data, OLD), 0);
});

test('a missing folder is reported and nothing is renamed', async () => {
  const fs = createFakeFs({ openError: 'ENOENT' });
  const target = path.join('save-root', 'missing', 'paper.obk');
  const result = await writeAtomic(target, NEXT, { fs });
  assert.equal(result.status, 'error');
  assert.equal(result.code, 'ENOENT');
  assert.equal(result.retryable, false);
  assert.equal(renamed(fs).length, 0);
});

test('cleanup removes only its own temp files older than 10 minutes', async () => {
  const dir = path.join('save-root', 'folder');
  const now = 5_000_000_000;
  const oldEnough = now - TEMP_MAX_AGE_MS - 1;
  const exactly = now - TEMP_MAX_AGE_MS;
  const young = now - TEMP_MAX_AGE_MS + 1;
  const oldName = tempFileName(Buffer.alloc(16, 1));
  const exactName = tempFileName(Buffer.alloc(16, 2));
  const youngName = tempFileName(Buffer.alloc(16, 3));
  const upper = `.~obk-${'AB'.repeat(16)}.tmp`;
  const shortName = '.~obk-abcd.tmp';
  const suffix = `${oldName}.bak`;
  const notes = 'notes.txt';
  const directoryName = tempFileName(Buffer.alloc(16, 4));
  const fs = createFakeFs({
    files: {
      [path.join(dir, oldName)]: { data: Buffer.from('partial'), mtimeMs: oldEnough },
      [path.join(dir, exactName)]: { data: Buffer.from('boundary'), mtimeMs: exactly },
      [path.join(dir, youngName)]: { data: Buffer.from('fresh'), mtimeMs: young },
      [path.join(dir, upper)]: { data: Buffer.from('upper'), mtimeMs: oldEnough },
      [path.join(dir, shortName)]: { data: Buffer.from('short'), mtimeMs: oldEnough },
      [path.join(dir, suffix)]: { data: Buffer.from('suffix'), mtimeMs: oldEnough },
      [path.join(dir, notes)]: { data: Buffer.from('keep'), mtimeMs: oldEnough },
      [path.join(dir, directoryName)]: { data: Buffer.alloc(0), mtimeMs: oldEnough, isFile: false },
      [path.join(dir, 'nested', oldName)]: { data: Buffer.from('nested'), mtimeMs: oldEnough },
    },
  });

  await removeStaleTempFiles(dir, { fs, now: () => now });

  assert.equal(fs.get(path.join(dir, oldName)), undefined);
  assert.ok(fs.get(path.join(dir, exactName)));
  assert.ok(fs.get(path.join(dir, youngName)));
  assert.ok(fs.get(path.join(dir, upper)));
  assert.ok(fs.get(path.join(dir, shortName)));
  assert.ok(fs.get(path.join(dir, suffix)));
  assert.ok(fs.get(path.join(dir, notes)));
  assert.ok(fs.get(path.join(dir, directoryName)));
  assert.ok(fs.get(path.join(dir, 'nested', oldName)));
  for (const name of unlinked(fs)) {
    assert.equal(TEMP_FILE_PATTERN.test(name), true, name);
  }
  const stated = fs.calls.filter((call) => call[0] === 'stat').map((call) => path.basename(call[1]));
  assert.deepEqual(stated.sort(), [directoryName, exactName, oldName, youngName].sort());
});

test('saving to a folder removes a leftover temp file and leaves other names', async () => {
  const dir = path.join('save-root', 'folder');
  const target = path.join(dir, 'paper.obk');
  const oldName = tempFileName(Buffer.alloc(16, 9));
  const notes = path.join(dir, 'notes.txt');
  const clock = createClock(TEMP_MAX_AGE_MS + 50);
  const fs = createFakeFs({
    files: {
      [target]: { data: OLD, mtimeMs: 0 },
      [path.join(dir, oldName)]: { data: Buffer.from('leftover'), mtimeMs: 0 },
      [notes]: { data: Buffer.from('keep me'), mtimeMs: 0 },
    },
  });
  const result = await writeAtomic(target, NEXT, { fs, now: clock.now, sleep: clock.sleep });
  assert.equal(result.status, 'ok');
  assert.equal(fs.get(path.join(dir, oldName)), undefined);
  assert.equal(fs.get(notes).data.toString(), 'keep me');
  assert.equal(Buffer.compare(fs.get(target).data, NEXT), 0);
});

test('a document is not saved under the app private AppData', async () => {
  const win = path.win32;
  const documents = defaultDocumentDirectory({
    documents: 'C:\\Users\\a\\OneDrive\\Documents',
    privateRoots: ['C:\\Users\\a\\AppData\\Roaming\\Obelisk'],
    pathApi: win,
  });
  assert.deepEqual(documents, { ok: true, directory: 'C:\\Users\\a\\OneDrive\\Documents' });

  const underAppData = defaultDocumentDirectory({
    documents: 'C:\\Users\\a\\AppData\\Roaming\\Obelisk',
    privateRoots: ['C:\\Users\\a\\AppData\\Roaming\\Obelisk'],
    pathApi: win,
  });
  assert.equal(underAppData.ok, false);
  assert.match(underAppData.message, /private AppData/);

  const cache = 'C:\\Users\\a\\AppData\\Local\\Packages\\Obelisk.Dev_abc\\LocalCache\\Roaming\\Obelisk';
  const redirected = defaultDocumentDirectory({
    documents: cache,
    privateRoots: [],
    pathApi: win,
  });
  assert.equal(redirected.ok, false);
  assert.equal(isPrivateDocumentPath('C:\\Users\\a\\Documents\\Obelisk\\paper.obk', [], win), false);
  assert.equal(isPrivateDocumentPath('C:\\Users\\a\\AppData\\Local\\Temp\\paper.obk', [], win), false);
  assert.equal(isPrivateDocumentPath('C:\\Users\\a\\AppData\\Local\\Obelisk\\paper.obk', [], win), true);

  const refusedTarget = 'C:\\Users\\a\\AppData\\Roaming\\Obelisk\\paper.obk';
  const fs = createFakeFs({ pathApi: win });
  const refused = await writeAtomic(refusedTarget, NEXT, { fs, pathApi: win });
  assert.equal(refused.status, 'error');
  assert.equal(refused.code, 'PATH_NOT_ALLOWED');
  assert.equal(refused.retryable, false);
  assert.equal(fs.calls.length, 0);

  const cacheTarget = `${cache}\\paper.obk`;
  const cacheFs = createFakeFs({ pathApi: win });
  const cacheResult = await writeAtomic(cacheTarget, NEXT, { fs: cacheFs, pathApi: win });
  assert.equal(cacheResult.code, 'PATH_NOT_ALLOWED');
  assert.equal(cacheFs.calls.length, 0);

  const customRoot = 'D:\\custom-data';
  const customTarget = 'D:\\custom-data\\paper.obk';
  const customFs = createFakeFs({ pathApi: win });
  const custom = await writeAtomic(customTarget, NEXT, {
    fs: customFs,
    pathApi: win,
    privateAppData: [customRoot],
  });
  assert.equal(custom.code, 'PATH_NOT_ALLOWED');
  assert.equal(customFs.calls.length, 0);

  const recordFs = createFakeFs({ pathApi: win });
  const record = await writeAtomic(refusedTarget, NEXT, { fs: recordFs, pathApi: win, kind: 'record' });
  assert.equal(record.status, 'ok');
  assert.equal(Buffer.compare(recordFs.get(refusedTarget).data, NEXT), 0);
});

test('launch removes stale temp files in the folder it is given', async () => {
  const dir = path.join('save-root', 'Obelisk');
  const stale = tempFileName(Buffer.alloc(16, 7));
  const keep = 'preferences.json';
  const fs = createFakeFs({
    files: {
      [path.join(dir, stale)]: { data: Buffer.from('old'), mtimeMs: 0 },
      [path.join(dir, keep)]: { data: Buffer.from('{}'), mtimeMs: 0 },
    },
  });
  await removeStaleTempFiles(dir, { fs, now: () => TEMP_MAX_AGE_MS + 1 });
  assert.equal(fs.get(path.join(dir, stale)), undefined);
  assert.equal(fs.get(path.join(dir, keep)).data.toString(), '{}');

  const entry = await readFile(path.join(root, 'src/main/index.ts'), 'utf8');
  const configured = entry.indexOf('const userData = configureWritablePaths()');
  const cleanup = entry.indexOf('removeStaleTempFiles(userData)');
  const smoke = entry.indexOf("process.env.OBELISK_PACKAGED_SMOKE === '1'");
  assert.ok(configured !== -1 && cleanup !== -1 && smoke !== -1);
  assert.ok(configured < cleanup && cleanup < smoke);
});

test('the real file system replaces a file and removes only an old temp', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'obelisk-atomic-'));
  try {
    const target = path.join(dir, 'paper.obk');
    await writeFile(target, OLD);
    const stale = path.join(dir, tempFileName(Buffer.alloc(16, 5)));
    const young = path.join(dir, tempFileName(Buffer.alloc(16, 6)));
    const lookalike = path.join(dir, 'notes.tmp');
    await writeFile(stale, Buffer.from('partial'));
    await writeFile(young, Buffer.from('fresh'));
    await writeFile(lookalike, Buffer.from('leave this'));
    const oldTime = new Date(Date.now() - TEMP_MAX_AGE_MS - 60_000);
    await utimes(stale, oldTime, oldTime);

    const created = await writeAtomic(path.join(dir, 'new.obk'), NEXT);
    assert.equal(created.status, 'ok');
    assert.equal(Buffer.compare(await readFile(path.join(dir, 'new.obk')), NEXT), 0);

    const replaced = await writeAtomic(target, NEXT);
    assert.equal(replaced.status, 'ok');
    assert.equal(replaced.stat.size, NEXT.length);
    assert.equal(Buffer.compare(await readFile(target), NEXT), 0);

    const names = await readdir(dir);
    assert.equal(names.includes(path.basename(stale)), false);
    assert.equal(names.includes(path.basename(young)), true);
    assert.equal(names.includes('notes.tmp'), true);
    assert.equal(names.includes('paper.obk'), true);
    assert.equal(names.includes('new.obk'), true);
    assert.equal(
      names.some((name) => TEMP_FILE_PATTERN.test(name) && name !== path.basename(young)),
      false,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a read-only file on Windows is left unchanged', { skip: process.platform !== 'win32' }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'obelisk-atomic-'));
  const target = path.join(dir, 'paper.obk');
  try {
    await writeFile(target, OLD);
    await chmod(target, 0o444);
    const result = await writeAtomic(target, NEXT);
    assert.equal(result.status, 'error');
    assert.equal(result.code, 'EACCES');
    assert.match(result.message, /read-only/i);
    assert.equal(Buffer.compare(await readFile(target), OLD), 0);
  } finally {
    await chmod(target, 0o666).catch(() => undefined);
    await rm(dir, { recursive: true, force: true });
  }
});
