import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  checkNfr23Coverage,
  formatNfr23ThresholdMessage,
  nfr23CoverageFromLcov,
} from '../../coverage/check-threshold.mjs';

function lcovFor(file, linesFound, linesHit) {
  const lines = [];
  for (let line = 1; line <= linesFound; line += 1) {
    lines.push(`DA:${line},${line <= linesHit ? 1 : 0}`);
  }
  return [`SF:${file}`, ...lines, `LH:${linesHit}`, `LF:${linesFound}`, 'end_of_record'].join('\n');
}

test('nfr23CoverageFromLcov sums only scoped modules', () => {
  const text = [
    lcovFor('src/main/codec/decode.ts', 10, 9),
    lcovFor('src/main/file/writeAtomic.ts', 10, 10),
    lcovFor('src/main/export/service.ts', 10, 1),
    lcovFor('src/renderer/blocks/table/math/index.ts', 5, 4),
  ].join('\n');
  const result = nfr23CoverageFromLcov(text, { target: 80 });
  assert.equal(result.rows.length, 3);
  assert.equal(result.totals.linesFound, 25);
  assert.equal(result.totals.linesHit, 23);
  assert.equal(result.met, true);
});

test('formatNfr23ThresholdMessage names the threshold', () => {
  const message = formatNfr23ThresholdMessage({
    target: 80,
    totals: { linesHit: 16, linesFound: 20 },
    met: true,
    rows: [],
  });
  assert.match(message, /80\.00%/);
  assert.match(message, /target 80%/);
  assert.match(message, /threshold is met/);
});

test('checkNfr23Coverage fails when aggregate is under the target', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-cov-'));
  const lcovPath = path.join(directory, 'lcov.info');
  try {
    await writeFile(lcovPath, lcovFor('src/shared/schema/result.ts', 10, 5));
    const check = checkNfr23Coverage(lcovPath);
    assert.equal(check.ok, false);
    assert.equal(check.result.met, false);
    assert.match(check.message, /threshold is not met/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('missing lcov report fails the check', () => {
  const check = checkNfr23Coverage(path.join(tmpdir(), `missing-${process.pid}-${Date.now()}.info`));
  assert.equal(check.ok, false);
  assert.match(check.message, /not found/);
});