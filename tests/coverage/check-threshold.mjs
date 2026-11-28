import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LINE_COVERAGE_TARGET,
  coverageRows,
  formatLinePercent,
  meetsLineTarget,
  parseLcov,
} from '../../scripts/coverage-report.mjs';
import { isNfr23Module } from './nfr23-scope.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const defaultLcov = path.join(root, 'coverage', 'lcov.info');

export function nfr23CoverageFromLcov(text, options = {}) {
  const target = options.target ?? LINE_COVERAGE_TARGET;
  const rows = coverageRows(parseLcov(text), { root, target }).filter((row) =>
    isNfr23Module(row.file),
  );
  const totals = rows.reduce(
    (sum, row) => ({
      linesHit: sum.linesHit + row.linesHit,
      linesFound: sum.linesFound + row.linesFound,
    }),
    { linesHit: 0, linesFound: 0 },
  );
  return {
    target,
    rows,
    totals,
    met: meetsLineTarget(totals.linesHit, totals.linesFound, target),
  };
}

export function formatNfr23ThresholdMessage(result) {
  const { target, totals, met } = result;
  const percent = formatLinePercent(totals.linesHit, totals.linesFound);
  const lines = [
    `NFR-23 line coverage for file format, save, and table math modules: ${percent} (${totals.linesHit}/${totals.linesFound} lines, target ${target}%).`,
  ];
  if (met) {
    lines.push(`The ${target}% threshold is met.`);
  } else {
    lines.push(`The ${target}% threshold is not met.`);
    const under = result.rows.filter((row) => !row.met);
    if (under.length > 0) {
      lines.push(`${under.length} scoped module${under.length === 1 ? '' : 's'} are under ${target}%:`);
      for (const row of under) {
        lines.push(
          `  ${row.file} ${formatLinePercent(row.linesHit, row.linesFound)} (${row.linesHit}/${row.linesFound})`,
        );
      }
    }
  }
  return lines.join('\n');
}

export function checkNfr23Coverage(lcovPath = defaultLcov, options = {}) {
  if (!existsSync(lcovPath)) {
    return {
      ok: false,
      message: `Coverage report not found at ${lcovPath}. Run npm test first.`,
      result: null,
    };
  }
  const result = nfr23CoverageFromLcov(readFileSync(lcovPath, 'utf8'), options);
  const message = formatNfr23ThresholdMessage(result);
  return { ok: result.met, message, result };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const lcovPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultLcov;
  const { ok, message } = checkNfr23Coverage(lcovPath);
  if (message) {
    console.error(message);
  }
  process.exit(ok ? 0 : 1);
}