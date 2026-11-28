import path from 'node:path';
import type { PlatformPath } from 'node:path';

export function markdownImagesFolderName(mdPath: string, pathApi: PlatformPath = path): string {
  const base = pathApi.basename(mdPath, pathApi.extname(mdPath));
  return `${base}_images`;
}

export function markdownImagesFolderPath(mdPath: string, pathApi: PlatformPath = path): string {
  return pathApi.join(pathApi.dirname(mdPath), markdownImagesFolderName(mdPath, pathApi));
}