import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatCoverageReport, parseLcov } from './coverage-report.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lcovPath = path.join(root, 'coverage', 'lcov.info');

function exitCode(result) {
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  return result.status ?? 1;
}

function run(args) {
  return spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
  });
}

const build = run([path.join('scripts', 'build.mjs')]);
const buildCode = exitCode(build);
if (buildCode !== 0) {
  process.exit(buildCode);
}

mkdirSync(path.dirname(lcovPath), { recursive: true });

// NFR-23 is a reported 80% line-coverage target, not a failing threshold.
// Do not pass --test-coverage-lines; that flag fails the process.
const testRun = run([
  '--enable-source-maps',
  '--test',
  '--experimental-test-coverage',
  '--test-reporter=spec',
  '--test-reporter=lcov',
  '--test-reporter-destination=stdout',
  `--test-reporter-destination=${lcovPath}`,
  '--test-coverage-exclude=**/node_modules/**',
  '--test-coverage-exclude=**/tests/**',
  '--test-coverage-exclude=**/*test.mjs',
  '--test-coverage-exclude=**/scripts/**',
  '--test-coverage-exclude=**/coverage/**',
  '--test-coverage-exclude=**/docs/**',
  '--test-coverage-exclude=**/dist/renderer/**',
  '--test-coverage-exclude=**/eslint.config.mjs',
  '--test-coverage-exclude=**/vite.config.mts',
  '--test-coverage-exclude=**/vite.preload.config.mts',
  ...process.argv.slice(2),
]);
const testCode = exitCode(testRun);

let report = '';
try {
  report = formatCoverageReport(parseLcov(readFileSync(lcovPath, 'utf8')), {
    root,
    includePrefix: 'src/',
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(testCode === 0 ? 1 : testCode);
}

process.stdout.write(`\n${report}`);
if (testCode !== 0) {
  process.exit(testCode);
}
if (!report.includes('module') || report.includes('No modules were measured.')) {
  console.error('The coverage report did not list any modules.');
  process.exit(1);
}
