import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { archiveMessage } from '../../../dist/main/codec/archive/index.js';
import { decodeObk } from '../../../dist/main/codec/decode.js';
import { encodeObk } from '../../../dist/main/codec/encode/index.js';
import { openLaunchPaths } from '../../../dist/main/file/activation.js';
import { launchPathsFromArgv } from '../../../dist/main/file/launchPaths.js';
import { createFileService } from '../../../dist/main/file/service.js';
import {
  emptyManifest,
  minimalDocument,
  paragraph,
  textRun,
} from '../../../scripts/make-hostile-fixtures/documents.mjs';

async function writeSampleObk(filePath, label) {
  const encoded = await encodeObk(
    minimalDocument([paragraph(3, [textRun(label)])]),
    emptyManifest('0.1.64.0'),
  );
  assert.equal(encoded.ok, true, encoded.message);
  await writeFile(filePath, encoded.bytes);
}

test('openLaunchPaths opens each path and reports results in order', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-activation-'));
  const first = path.join(directory, 'first.obk');
  const second = path.join(directory, 'second.obk');
  await writeSampleObk(first, 'First');
  await writeSampleObk(second, 'Second');
  const files = createFileService({ readObk: (filePath) => decodeObk(filePath) });
  const seen = [];
  await openLaunchPaths(files, [first, second], (result) => {
    seen.push(result);
  });
  assert.equal(seen.length, 2);
  assert.equal(seen[0].status, 'ok');
  assert.equal(seen[0].name, 'first.obk');
  assert.equal(seen[1].status, 'ok');
  assert.equal(seen[1].name, 'second.obk');
});

test('openLaunchPaths uses the unreadable archive message for a missing file', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-activation-miss-'));
  const missing = path.join(directory, 'gone.obk');
  const files = createFileService({ readObk: (filePath) => decodeObk(filePath) });
  const seen = [];
  await openLaunchPaths(files, [missing], (result) => {
    seen.push(result);
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].status, 'refused');
  assert.equal(seen[0].reason, 'unreadable');
  assert.equal(seen[0].message, archiveMessage('unreadable'));
});

test('launchPathsFromArgv matches the H-25 Explorer argv fixture', async () => {
  const many = Array.from({ length: 21 }, (_, index) => `paper-${String(index + 1).padStart(2, '0')}.obk`);
  const argv = [
    'Obelisk.exe',
    '--inspect',
    '--no-sandbox',
    'C:\\Notes',
    ...many,
  ];
  assert.equal(argv.filter((arg) => arg.endsWith('.obk')).length, 21);
  const kept = launchPathsFromArgv(argv);
  assert.equal(kept.length, 20);
  assert.deepEqual(kept, many.slice(0, 20));
});