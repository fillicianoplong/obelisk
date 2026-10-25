import assert from 'node:assert/strict';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { FuseState, FuseV1Options, getCurrentFuseWire } from '@electron/fuses';
import { existingElectronBinary } from '../../../scripts/electron-binary.mjs';
import {
  assertFusesOff,
  describeFuseState,
  disabledFuseProblems,
  flipRequiredFusesOff,
} from '../../../scripts/fuses.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('the fuses check fails while runAsNode or nodeCliInspect is on', () => {
  const enabled = {
    [FuseV1Options.RunAsNode]: FuseState.ENABLE,
    [FuseV1Options.EnableNodeCliInspectArguments]: FuseState.DISABLE,
  };
  assert.deepEqual(disabledFuseProblems(enabled), ['runAsNode is on']);
  assert.equal(describeFuseState(FuseState.ENABLE), 'on');
  assert.equal(describeFuseState(undefined), 'missing');

  const missingInspect = {
    [FuseV1Options.RunAsNode]: FuseState.DISABLE,
  };
  assert.deepEqual(disabledFuseProblems(missingInspect), ['nodeCliInspect is missing']);

  const off = {
    [FuseV1Options.RunAsNode]: FuseState.DISABLE,
    [FuseV1Options.EnableNodeCliInspectArguments]: FuseState.REMOVED,
  };
  assert.deepEqual(disabledFuseProblems(off), []);
});

test('package-time fuse flip turns runAsNode and nodeCliInspect off', { timeout: 120_000 }, async () => {
  const binary = existingElectronBinary(root);
  assert.ok(binary, 'the Electron binary is installed before unit tests');
  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-fuses-'));
  const copy = path.join(directory, path.basename(binary));
  try {
    const stock = await getCurrentFuseWire(binary);
    assert.equal(stock[FuseV1Options.RunAsNode], FuseState.ENABLE);
    assert.equal(stock[FuseV1Options.EnableNodeCliInspectArguments], FuseState.ENABLE);
    await assert.rejects(() => assertFusesOff(binary), /runAsNode is on/);

    await copyFile(binary, copy);
    await flipRequiredFusesOff(copy);
    const flipped = await assertFusesOff(copy);
    assert.equal(flipped[FuseV1Options.RunAsNode], FuseState.DISABLE);
    assert.equal(flipped[FuseV1Options.EnableNodeCliInspectArguments], FuseState.DISABLE);
    for (const option of Object.values(FuseV1Options)) {
      if (typeof option !== 'number') {
        continue;
      }
      if (
        option === FuseV1Options.RunAsNode ||
        option === FuseV1Options.EnableNodeCliInspectArguments
      ) {
        continue;
      }
      if (stock[option] === undefined) {
        continue;
      }
      assert.equal(flipped[option], stock[option], `fuse ${option} changed`);
    }

    const after = await getCurrentFuseWire(binary);
    assert.equal(after[FuseV1Options.RunAsNode], FuseState.ENABLE);
    assert.equal(after[FuseV1Options.EnableNodeCliInspectArguments], FuseState.ENABLE);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
