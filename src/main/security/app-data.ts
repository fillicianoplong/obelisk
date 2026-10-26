import path from 'node:path';
import type { PlatformPath } from 'node:path';

export const APP_DATA_DIR_NAME = 'Obelisk';

export const SMOKE_MARKER_FILE = 'smoke-write.txt';

export function resolveAppDataDir(
  appDataDir: string,
  userDataFlag: string | undefined,
  cwd: string,
  pathApi: PlatformPath = path,
): string {
  const explicit = userDataFlag?.trim() ?? '';
  if (explicit !== '') {
    return pathApi.resolve(cwd, explicit);
  }
  return pathApi.join(appDataDir, APP_DATA_DIR_NAME);
}

function comparable(resolved: string, pathApi: PlatformPath): string {
  return pathApi === path.win32 ? resolved.toLowerCase() : resolved;
}

export function isInsideDirectory(
  parent: string,
  candidate: string,
  pathApi: PlatformPath = path,
): boolean {
  const from = comparable(pathApi.resolve(parent), pathApi);
  const to = comparable(pathApi.resolve(candidate), pathApi);
  const relative = pathApi.relative(from, to);
  if (relative === '') {
    return true;
  }
  if (pathApi.isAbsolute(relative)) {
    return false;
  }
  return !relative.split(pathApi.sep).includes('..');
}
