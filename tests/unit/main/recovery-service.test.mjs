import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { minimalDocument, paragraph, textRun } from '../../../scripts/make-hostile-fixtures/documents.mjs';

const serviceUrl = pathToFileURL(path.resolve('dist/main/recovery/service.js')).href;
const encodeUrl = pathToFileURL(path.resolve('dist/main/codec/encode/index.js')).href;
const decodeUrl = pathToFileURL(path.resolve('dist/main/codec/decode.js')).href;

const { createRecoveryService } = await import(serviceUrl);
const { encodeObk } = await import(encodeUrl);
const { decodeObk } = await import(decodeUrl);

const manifest = {
  format: 'obelisk',
  formatVersion: 1,
  writer: 'recovery-test',
};

test('recovery put, list, restore, and drop write atomically in app data', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'obelisk-recovery-'));
  const service = createRecoveryService({
    userDataDir: userData,
    writer: manifest.writer,
    privateAppData: [userData],
    readObk: (filePath) => decodeObk(filePath),
  });
  const document = minimalDocument([paragraph(3, [textRun('Storm notes')])]);
  const firstLine = 'Storm notes';

  const put = await service.put({ recoveryId: null, document, firstLine });
  assert.equal(put.status, 'ok');
  const id = put.recoveryId;

  const dir = path.join(userData, 'recovery');
  const names = await readdir(dir);
  assert.deepEqual(new Set(names), new Set([`${id}.json`, `${id}.obk`]));

  const listed = await service.list();
  assert.equal(listed.status, 'ok');
  assert.equal(listed.entries.length, 1);
  assert.equal(listed.entries[0].id, id);
  assert.equal(listed.entries[0].firstLine, firstLine);

  const restored = await service.restore({ recoveryId: id });
  assert.equal(restored.status, 'ok');
  assert.equal(restored.recoveryId, id);
  assert.equal(restored.handle, undefined);
  assert.equal(restored.document.blocks.length, document.blocks.length);

  const updated = await service.put({
    recoveryId: id,
    document: minimalDocument([paragraph(3, [textRun('Storm notes — revised')])]),
    firstLine: 'Storm notes — revised',
  });
  assert.equal(updated.status, 'ok');
  assert.equal(updated.recoveryId, id);
  const meta = JSON.parse(await readFile(path.join(dir, `${id}.json`), 'utf8'));
  assert.equal(meta.firstLine, 'Storm notes — revised');

  const dropped = await service.drop(id);
  assert.equal(dropped.status, 'ok');
  assert.equal((await readdir(dir)).length, 0);

  await rm(userData, { recursive: true, force: true });
});

test('a damaged recovery copy is refused on restore', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'obelisk-recovery-bad-'));
  const service = createRecoveryService({
    userDataDir: userData,
    writer: manifest.writer,
    privateAppData: [userData],
    readObk: (filePath) => decodeObk(filePath),
  });
  const id = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const dir = path.join(userData, 'recovery');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${id}.json`), `${JSON.stringify({
    version: 1,
    createdMs: 1,
    updatedMs: 2,
    firstLine: 'Broken',
  })}\n`);
  await writeFile(path.join(dir, `${id}.obk`), 'not an obk archive');

  const restored = await service.restore({ recoveryId: id });
  assert.equal(restored.status, 'refused');

  const dropped = await service.drop(id);
  assert.equal(dropped.status, 'ok');

  await rm(userData, { recursive: true, force: true });
});

test('recovery cleanup reports notFound for a missing id', async () => {
  const userData = await mkdtemp(path.join(tmpdir(), 'obelisk-recovery-missing-'));
  const service = createRecoveryService({
    userDataDir: userData,
    privateAppData: [userData],
    readObk: () => Promise.reject(new Error('unused')),
  });
  assert.equal((await service.drop('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')).status, 'notFound');
  await rm(userData, { recursive: true, force: true });
});