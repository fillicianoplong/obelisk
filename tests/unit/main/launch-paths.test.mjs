import assert from 'node:assert/strict';
import test from 'node:test';
import {
  candidatePathsFromArgv,
  isObkLaunchPath,
  launchPathsFromArgv,
  LAUNCH_FILE_MAX,
} from '../../../dist/main/file/launchPaths.js';

test('launchPathsFromArgv keeps only .obk paths and skips flags and scripts', () => {
  const cafe = `Lesson 04 ${String.fromCharCode(0x2014)} caf${String.fromCharCode(0x00e9)}.obk`;
  const sample = launchPathsFromArgv([
    'Obelisk.exe',
    '--remote-debugging-port=9222',
    '--output',
    'C:\\out',
    `C:\\Docs\\${cafe}`,
    'C:\\app\\dist\\main\\index.js',
    'C:\\notes\\draft.obk',
  ]);
  assert.deepEqual(sample, [`C:\\Docs\\${cafe}`, 'C:\\notes\\draft.obk']);

  const three = launchPathsFromArgv(['exe', 'a.obk', 'b.obk', 'c.obk']);
  assert.deepEqual(three, ['a.obk', 'b.obk', 'c.obk']);

  const mixed = launchPathsFromArgv(['exe', 'readme.txt', 'paper.obk']);
  assert.deepEqual(mixed, ['paper.obk']);
});

test('launchPathsFromArgv keeps at most twenty files', () => {
  const many = Array.from({ length: 25 }, (_, index) => `file-${index}.obk`);
  const kept = launchPathsFromArgv(['exe', ...many]);
  assert.equal(kept.length, LAUNCH_FILE_MAX);
  assert.deepEqual(kept, many.slice(0, LAUNCH_FILE_MAX));
});

test('candidatePathsFromArgv and isObkLaunchPath match spike S-02 parsing', () => {
  assert.equal(isObkLaunchPath('Notes.OBK'), true);
  assert.equal(isObkLaunchPath('readme.txt'), false);
  const reportPath = String.raw`C:\out\report.json`;
  const obkPath = String.raw`C:\a.obk`;
  const raw = candidatePathsFromArgv(['exe', '--report', reportPath, obkPath]);
  assert.deepEqual(raw, [obkPath], 'the path after --report is the flag value, not a launch candidate');
  assert.deepEqual(
    candidatePathsFromArgv(['exe', reportPath, obkPath]),
    [reportPath, obkPath],
  );
  assert.deepEqual(launchPathsFromArgv(['exe', '--report', reportPath, obkPath]), [obkPath]);
});
