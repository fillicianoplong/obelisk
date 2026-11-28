import { randomBytes } from 'node:crypto';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { PlatformPath } from 'node:path';
import { ipcError } from '../../shared/ipc/errors.js';
import { writeAtomic, type WriteAtomicOptions, type WriteAtomicResult } from '../file/writeAtomic.js';
import { EXPORT_DENIED_MESSAGE } from './constants.js';
import type { ExportCompanionFile } from './writers/types.js';

const TEMP_FOLDER_PREFIX = '.~obk-md-';

function tempFolderName(random: (size: number) => Uint8Array): string {
  const hex = Buffer.from(random(8)).toString('hex');
  return `${TEMP_FOLDER_PREFIX}${hex}`;
}

async function folderExists(folderPath: string): Promise<boolean> {
  try {
    const info = await stat(folderPath);
    return info.isDirectory();
  } catch {
    return false;
  }
}

export async function writeExportCompanions(
  mdPath: string,
  companions: readonly ExportCompanionFile[],
  options: WriteAtomicOptions = {},
): Promise<WriteAtomicResult> {
  if (companions.length < 1) {
    return { status: 'ok', stat: { size: 0, modifiedMs: options.now?.() ?? Date.now() } };
  }
  const pathApi: PlatformPath = options.pathApi ?? path;
  const parent = pathApi.dirname(mdPath);
  const folderTargets = new Map<string, ExportCompanionFile[]>();
  for (const file of companions) {
    const parts = file.relativePath.replace(/\\/g, '/').split('/');
    const folder = parts.slice(0, -1).join('/');
    const list = folderTargets.get(folder) ?? [];
    list.push(file);
    folderTargets.set(folder, list);
  }
  for (const [folder, files] of folderTargets) {
    const folderPath = pathApi.join(parent, folder);
    const existed = await folderExists(folderPath);
    if (!existed) {
      const tempPath = pathApi.join(parent, tempFolderName(options.randomBytes ?? randomBytes));
      await mkdir(tempPath, { recursive: true });
      for (const file of files) {
        const name = pathApi.basename(file.relativePath);
        const target = pathApi.join(tempPath, name);
        const written = await writeAtomic(target, file.bytes, { ...options, kind: 'record' });
        if (written.status !== 'ok') {
          await rm(tempPath, { recursive: true, force: true });
          return written;
        }
      }
      try {
        await rename(tempPath, folderPath);
      } catch {
        await rm(tempPath, { recursive: true, force: true });
        return ipcError('EACCES', EXPORT_DENIED_MESSAGE);
      }
      continue;
    }
    for (const file of files) {
      const target = pathApi.join(parent, file.relativePath);
      await mkdir(pathApi.dirname(target), { recursive: true });
      const written = await writeAtomic(target, file.bytes, { ...options, kind: 'record' });
      if (written.status !== 'ok') {
        return written;
      }
    }
  }
  return { status: 'ok', stat: { size: 0, modifiedMs: options.now?.() ?? Date.now() } };
}