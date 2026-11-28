import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  defaultExportPath,
  ensureExportName,
  exportFileName,
} from '../../../dist/main/export/path.js';

test('ensureExportName sets the export extension itself', () => {
  assert.equal(ensureExportName('/docs/Lab notes', 'pdf'), '/docs/Lab notes.pdf');
  assert.equal(ensureExportName('/docs/report.obk', 'docx'), '/docs/report.obk.docx');
  assert.equal(ensureExportName('/docs/paper.md', 'markdown'), '/docs/paper.md');
  assert.equal(ensureExportName('/docs/paper.pdf', 'pdf'), '/docs/paper.pdf');
});

test('defaultExportPath follows the open document or Untitled', () => {
  assert.equal(
    defaultExportPath('/docs/Lab notes.obk', 'pdf', '/home/user/Documents', [], path.posix),
    '/docs/Lab notes.pdf',
  );
  const untitled = defaultExportPath(null, 'markdown', '/home/user/Documents', []);
  assert.equal(untitled?.endsWith('Untitled.md'), true);
});

test('exportFileName swaps the extension for a base name', () => {
  assert.equal(exportFileName('Essay', 'docx'), 'Essay.docx');
  assert.equal(exportFileName('Essay.pdf', 'markdown'), 'Essay.md');
});