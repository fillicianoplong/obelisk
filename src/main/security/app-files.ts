import fs from 'node:fs/promises';
import path from 'node:path';
import { mimeTypeFor, resolveAppFile } from './app-path.js';

export interface AppFile {
  data: Buffer;
  mime: string;
}

function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  if (relative === '' || path.isAbsolute(relative)) {
    return false;
  }
  return !relative.split(path.sep).includes('..');
}

export async function readAppFile(root: string, requestUrl: string): Promise<AppFile | null> {
  const candidate = resolveAppFile(root, requestUrl);
  if (candidate === null) {
    return null;
  }
  const mime = mimeTypeFor(candidate);
  if (mime === null) {
    return null;
  }

  let rootReal: string;
  let fileReal: string;
  try {
    rootReal = await fs.realpath(root);
    fileReal = await fs.realpath(candidate);
  } catch {
    return null;
  }
  if (!isInsideRoot(rootReal, fileReal)) {
    return null;
  }

  try {
    const stat = await fs.stat(fileReal);
    if (!stat.isFile()) {
      return null;
    }
    return { data: await fs.readFile(fileReal), mime };
  } catch {
    return null;
  }
}
