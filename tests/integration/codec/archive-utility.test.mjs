import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { HOSTILE_MANIFEST } from '../../../scripts/make-hostile-fixtures/generate.mjs';
import { craftZip, storedEntry } from '../../../scripts/make-hostile-fixtures/zip.mjs';
import {
  bindLaunchedApp,
  electronBinary,
  launchWithSandboxFallback,
  repoRoot,
} from '../electron-launch.mjs';

test('the utility process refuses a missing document.json and leaves the file unchanged', { timeout: 45_000 }, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-archive-utility-'));
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'obelisk-archive-utility-data-'));
  const file = path.join(directory, 'missing-document.obk');
  const bytes = craftZip({
    entries: [storedEntry('manifest.json', HOSTILE_MANIFEST)],
  });
  await writeFile(file, bytes);
  const before = createHash('sha256').update(bytes).digest('hex');
  const session = { child: undefined, client: undefined, userDataDir };
  const finish = bindLaunchedApp(t, session);

  try {
    session.child = await launchWithSandboxFallback({
      binary: electronBinary(),
      args: [
        path.join(repoRoot, 'dist', 'main', 'codec', 'utility-host.js'),
        `--user-data-dir=${userDataDir}`,
        '--archive',
        file,
      ],
      ready(running) {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error(`No archive result.\n${running.output ?? ''}`));
          }, 20_000);
          const done = (failed) => {
            clearTimeout(timer);
            if (failed) {
              reject(failed);
              return;
            }
            resolve();
          };
          const look = () => {
            if ((running.output ?? '').includes('OBELISK_ARCHIVE_RESULT ')) {
              done();
            }
          };
          running.stdout?.on('data', look);
          running.stderr?.on('data', look);
          running.once('exit', () => {
            if ((running.output ?? '').includes('OBELISK_ARCHIVE_RESULT ')) {
              done();
              return;
            }
            done(new Error(`Archive process exited.\n${running.output ?? ''}`));
          });
          look();
        });
      },
    });

    const output = session.child.output ?? '';
    const line = output.split('\n').find((item) => item.includes('OBELISK_ARCHIVE_RESULT '));
    assert.ok(line, output);
    const result = JSON.parse(line.slice(line.indexOf('{')));
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'missing-document');
    assert.equal(result.path, 'document.json');
    assert.match(result.message, /document\.json/);
    assert.match(result.message, /not opened/);
    assert.equal(result.payloadsRead, 0);
    const after = createHash('sha256').update(await readFile(file)).digest('hex');
    assert.equal(after, before);
  } finally {
    await finish();
    await rm(directory, { recursive: true, force: true });
  }
});
