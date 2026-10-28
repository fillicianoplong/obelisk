import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatCoverageReport, parseLcov } from './coverage-report.mjs';
import { ensureElectronBinary } from './electron-binary.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const coverageDir = path.join(root, 'coverage');
const lcovPath = path.join(coverageDir, 'lcov.info');

// Node integration tests. Electron launch files stay in electronTestFiles.
const nodeIntegrationFiles = [
  path.join('tests', 'integration', 'file', 'kill-during-save.test.mjs'),
  path.join('tests', 'integration', 'hostile.test.mjs'),
];

const electronTestFiles = [
  path.join('tests', 'integration', 'smoke', 'opens-window.test.mjs'),
  path.join('tests', 'integration', 'security', 'window-baseline.test.mjs'),
  path.join('tests', 'integration', 'shell', 'window-shell.test.mjs'),
  path.join('tests', 'integration', 'shell', 'theme-window.test.mjs'),
  path.join('tests', 'integration', 'shell', 'page-focus.test.mjs'),
  path.join('tests', 'integration', 'shell', 'page-sheet.test.mjs'),
  path.join('tests', 'integration', 'shell', 'region-cycle.test.mjs'),
  path.join('tests', 'integration', 'shell', 'tab-strip.test.mjs'),
  path.join('tests', 'integration', 'shell', 'menu-keys.test.mjs'),
  path.join('tests', 'integration', 'editor', 'tab-editor.test.mjs'),
  path.join('tests', 'integration', 'packaging', 'writes-app-data.test.mjs'),
];

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

function collectTestFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
      files.push(path.relative(root, full));
    }
  }
  return files.sort();
}

function readLcov(file) {
  try {
    const text = readFileSync(file, 'utf8');
    return text.endsWith('\n') ? text : `${text}\n`;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

const build = run([path.join('scripts', 'build.mjs')]);
const buildCode = exitCode(build);
if (buildCode !== 0) {
  process.exit(buildCode);
}

let electronBinaryPath;
try {
  electronBinaryPath = ensureElectronBinary(root);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
console.log(`Electron binary: ${electronBinaryPath}`);

mkdirSync(coverageDir, { recursive: true });

// NFR-23 is a reported 80% line-coverage target, not a failing threshold.
// Do not pass --test-coverage-lines; that flag fails the process.
const coverageArgs = [
  '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
  '--enable-source-maps',
  '--test',
  '--experimental-test-coverage',
  '--test-reporter=spec',
  '--test-reporter=lcov',
  '--test-reporter-destination=stdout',
  '--test-coverage-exclude=**/node_modules/**',
  '--test-coverage-exclude=**/tests/**',
  '--test-coverage-exclude=**/*test.mjs',
  '--test-coverage-exclude=**/scripts/**',
  '--test-coverage-exclude=**/coverage/**',
  '--test-coverage-exclude=**/docs/**',
  '--test-coverage-exclude=**/dist/renderer/**',
  // Node's coverage tree stores a leaf on a property named "file". A directory
  // with that name makes the report throw and the run exit 1.
  '--test-coverage-exclude=**/main/file/**',
  '--test-coverage-exclude=**/eslint.config.mjs',
  '--test-coverage-exclude=**/vite.config.mts',
  '--test-coverage-exclude=**/vite.preload.config.mts',
];

function runTests(lcovFile, args) {
  return run([...coverageArgs, `--test-reporter-destination=${lcovFile}`, ...args]);
}

const extra = process.argv.slice(2);
let testCode;
let lcovText;

if (extra.length > 0) {
  const extraLcov = path.join(coverageDir, 'lcov.extra.info');
  testCode = exitCode(runTests(extraLcov, extra));
  lcovText = readLcov(extraLcov);
} else {
  const electronLcov = path.join(coverageDir, 'lcov.electron.info');
  const unitLcov = path.join(coverageDir, 'lcov.unit.info');
  const unitFiles = collectTestFiles(path.join(root, 'tests', 'unit'));
  if (unitFiles.length === 0) {
    console.error('No unit tests were found.');
    process.exit(1);
  }
  // One Electron launch file at a time. A parallel pair used to extract and
  // spawn the same binary together.
  const electronCode = exitCode(
    runTests(electronLcov, ['--test-concurrency=1', ...electronTestFiles]),
  );
  const unitCode = exitCode(runTests(unitLcov, [...unitFiles, ...nodeIntegrationFiles]));
  testCode = electronCode !== 0 ? electronCode : unitCode;
  lcovText = `${readLcov(electronLcov)}${readLcov(unitLcov)}`;
}

writeFileSync(lcovPath, lcovText);

let report = '';
try {
  report = formatCoverageReport(parseLcov(lcovText), {
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
