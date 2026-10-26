import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { findKitTools } from '../../../scripts/windows-kit.mjs';

test('the Windows SDK lookup prefers the newest x64 tools', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'obelisk-kits-'));
  try {
    const older = path.join(root, '10.0.19041.0', 'x86');
    const newerX86 = path.join(root, '10.0.22621.0', 'x86');
    const newer = path.join(root, '10.0.22621.0', 'x64');
    await mkdir(older, { recursive: true });
    await mkdir(newerX86, { recursive: true });
    await mkdir(newer, { recursive: true });
    await writeFile(path.join(older, 'makeappx.exe'), '');
    await writeFile(path.join(older, 'signtool.exe'), '');
    await writeFile(path.join(older, 'makepri.exe'), '');
    await writeFile(path.join(newerX86, 'makeappx.exe'), '');
    await writeFile(path.join(newerX86, 'makepri.exe'), '');
    await writeFile(path.join(newer, 'makeappx.exe'), '');
    await writeFile(path.join(newer, 'signtool.exe'), '');
    await writeFile(path.join(newer, 'makepri.exe'), '');
    await mkdir(path.join(root, 'notes'), { recursive: true });

    const found = findKitTools([root, path.join(root, 'missing')]);
    assert.equal(found.makeappx, path.join(newer, 'makeappx.exe'));
    assert.equal(found.signtool, path.join(newer, 'signtool.exe'));
    assert.equal(found.makepri, path.join(newer, 'makepri.exe'));
    assert.deepEqual(findKitTools([]), { makeappx: null, signtool: null, makepri: null });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
