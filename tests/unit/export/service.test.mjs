import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createExportService } from '../../../dist/main/export/service.js';
import { EXPORT_TIMEOUT_MESSAGE } from '../../../dist/main/export/constants.js';
import { registerExportWriter } from '../../../dist/main/export/writers/index.js';
import { pdfExportWriter } from '../../../dist/main/export/writers/pdf.js';

const DOCUMENT = {
  view: 'pageless',
  page: {},
  header: {},
  footer: {},
  blocks: [],
};

const ASSETS = { mathml: [], formulaPngs: [], firstFramePngs: [] };

async function withDir(run) {
  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-export-'));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('Cancel at the replace prompt leaves the existing export file unchanged', async () => {
  await withDir(async (directory) => {
    const target = path.join(directory, 'Taken.pdf');
    await writeFile(target, 'already here');
    const before = await readFile(target);
    const service = createExportService({
      showExportDialog: async () => ({ canceled: false, filePath: target }),
      confirmReplace: async () => false,
      lookupHandle: () => null,
      documentsDirectory: () => directory,
      platform: 'linux',
    });
    const result = await service.run({
      format: 'pdf',
      handle: null,
      document: DOCUMENT,
      assets: ASSETS,
    });
    assert.equal(result.status, 'cancelled');
    assert.deepEqual(await readFile(target), before);
  });
});

test('An export past the time limit stops with a timeout and leaves no partial file', async () => {
  await withDir(async (directory) => {
    const target = path.join(directory, 'Slow.pdf');
    const previous = pdfExportWriter;
    registerExportWriter('pdf', {
      write() {
        return new Promise(() => {
          // Never settles; the service deadline should win.
        });
      },
    });
    try {
      const service = createExportService({
        showExportDialog: async () => ({ canceled: false, filePath: target }),
        lookupHandle: () => null,
        documentsDirectory: () => directory,
        platform: 'linux',
        exportTimeoutMs: 5,
        sleep: async () => {},
      });
      const result = await service.run({
        format: 'pdf',
        handle: null,
        document: DOCUMENT,
        assets: ASSETS,
      });
      assert.equal(result.status, 'timeout');
      assert.equal(result.message, EXPORT_TIMEOUT_MESSAGE);
      await assert.rejects(stat(target), { code: 'ENOENT' });
    } finally {
      registerExportWriter('pdf', previous);
    }
  });
});