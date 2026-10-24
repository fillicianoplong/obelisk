import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatCoverageReport,
  formatLinePercent,
  meetsLineTarget,
  parseLcov,
} from '../../../scripts/coverage-report.mjs';

const sample = [
  'SF:src/main/ipc/handlers.ts',
  'DA:1,1',
  'DA:2,1',
  'DA:3,0',
  'LH:28',
  'LF:35',
  'end_of_record',
  'SF:src/shared/app-info.ts',
  'DA:1,1',
  'LH:1',
  'LF:2',
  'end_of_record',
  'SF:/workspace/src/main/security/csp.ts',
  'LH:10',
  'LF:10',
  'end_of_record',
].join('\n');

test('line coverage meets the 80% target only at or above 80%', () => {
  assert.equal(meetsLineTarget(28, 35), true);
  assert.equal(meetsLineTarget(27, 35), false);
  assert.equal(meetsLineTarget(8, 10), true);
  assert.equal(meetsLineTarget(7, 10), false);
  assert.equal(meetsLineTarget(0, 0), false);
  assert.equal(formatLinePercent(28, 35), '80.00%');
  assert.equal(formatLinePercent(22, 33), '66.67%');
  assert.equal(formatLinePercent(71, 99), '71.72%');
});

test('the coverage report shows each module against the 80% target', () => {
  const records = parseLcov(sample.replaceAll('\n', '\r\n'));
  assert.equal(records.length, 3);
  assert.equal(records[0].linesHit, 28);
  assert.equal(records[0].linesFound, 35);

  const report = formatCoverageReport(records, { root: '/workspace' });
  assert.match(report, /Line coverage by module against the 80% target \(NFR-23\)/);
  assert.match(report, /src\/main\/ipc\/handlers\.ts\s+35\s+28\s+80\.00%\s+80%\s+yes/);
  assert.match(report, /src\/shared\/app-info\.ts\s+2\s+1\s+50\.00%\s+80%\s+no/);
  assert.match(report, /src\/main\/security\/csp\.ts\s+10\s+10\s+100\.00%\s+80%\s+yes/);
  assert.match(report, /all measured modules\s+47\s+39\s+82\.98%\s+80%\s+yes/);
  assert.match(report, /1 are under the 80% target|1 is under the 80% target/);
  assert.match(report, /does not fail the run when a module is under that target/);
});

test('the product report lists src modules', () => {
  const report = formatCoverageReport(
    parseLcov(
      [
        'SF:eslint.config.mjs',
        'LH:1',
        'LF:1',
        'end_of_record',
        'SF:src/shared/app-info.ts',
        'LH:1',
        'LF:1',
        'end_of_record',
      ].join('\n'),
    ),
    { includePrefix: 'src/' },
  );
  assert.equal(report.includes('eslint.config.mjs'), false);
  assert.match(report, /src\/shared\/app-info\.ts/);
});

test('a module under 80% is reported without throwing', () => {
  const report = formatCoverageReport(
    parseLcov('SF:src/shared/save.ts\nLH:1\nLF:4\nend_of_record\n'),
  );
  assert.match(report, /src\/shared\/save\.ts\s+4\s+1\s+25\.00%\s+80%\s+no/);
  assert.match(report, /does not fail the run/);
});
