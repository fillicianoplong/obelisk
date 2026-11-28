import assert from 'node:assert/strict';
import { readFileSync, statSync, mkdtempSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function runCheckLicenses() {
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'check-licenses.mjs')], {
    cwd: root,
    encoding: 'utf8',
  });
}

test('check-licenses passes on the repository', () => {
  const result = runCheckLicenses();
  assert.equal(
    result.status,
    0,
    `check-licenses failed:\n${result.stdout}\n${result.stderr}`,
  );
  assert.match(result.stdout, /check-licenses: ok/);
});

test('every SRS open-source component is listed for About', () => {
  const manifest = JSON.parse(
    readFileSync(path.join(root, 'resources', 'licenses', 'manifest.json'), 'utf8'),
  );
  const expected = [
    'Electron and Chromium',
    'React',
    'ProseMirror',
    'KaTeX',
    'mathml2omml',
    'docx',
    'JSZip (used by docx)',
    'yauzl',
    'yazl',
    'Mermaid',
    'Bundled fonts',
  ];
  assert.deepEqual(
    manifest.components.map((row) => row.name).sort(),
    expected.sort(),
  );
  const notices = readFileSync(
    path.join(root, 'src', 'renderer', 'shell', 'about', 'notices.ts'),
    'utf8',
  );
  for (const row of manifest.components) {
    assert.match(notices, new RegExp(`id: '${row.id}'`));
    const noticePath = path.join(root, 'resources', 'licenses', row.noticeFile);
    assert.equal(statSync(noticePath).isFile(), true, row.noticeFile);
    if (row.fullTextFile !== undefined) {
      assert.equal(
        statSync(path.join(root, 'resources', 'licenses', row.fullTextFile)).isFile(),
        true,
        row.fullTextFile,
      );
    }
  }
});

test('each bundled font family has an OFL license file', () => {
  const families = readFileSync(path.join(root, 'src', 'shared', 'fonts', 'manifest.ts'), 'utf8');
  const fontsDir = path.join(root, 'assets', 'fonts');
  for (const match of families.matchAll(/family: '([^']+)', licenseFile: '([^']+)'/g)) {
    const licensePath = path.join(fontsDir, match[2]);
    const text = readFileSync(licensePath, 'utf8');
    assert.match(text, /Open Font License|SIL\s+Open Font/i, match[1]);
  }
});

test('check-licenses fails when a notice file is missing', () => {
  const noticePath = path.join(root, 'resources', 'licenses', 'katex.txt');
  const backupDir = mkdtempSync(path.join(tmpdir(), 'obelisk-lic-'));
  const backupPath = path.join(backupDir, 'katex.txt');
  writeFileSync(backupPath, readFileSync(noticePath));
  unlinkSync(noticePath);
  try {
    const result = runCheckLicenses();
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}${result.stderr}`, /missing notice katex\.txt/);
  } finally {
    writeFileSync(noticePath, readFileSync(backupPath));
  }
});