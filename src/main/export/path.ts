import path from 'node:path';
import type { PlatformPath } from 'node:path';
import type { ExportFormat } from '../../shared/ipc/types.js';
import { defaultDocumentDirectory } from '../file/writeAtomic.js';
import { exportFormatSpec } from './formats.js';

export const UNTITLED_EXPORT_BASE = 'Untitled';

const FILE_NAME_MAX = 255;

export function exportExtension(format: ExportFormat): string {
  return `.${exportFormatSpec(format).extension}`;
}

export function exportFileName(baseName: string, format: ExportFormat, pathApi: PlatformPath = path): string {
  const ext = exportExtension(format);
  if (baseName.toLowerCase().endsWith(ext.toLowerCase())) {
    return baseName;
  }
  return `${pathApi.parse(baseName).name}${ext}`;
}

// The filter does not change the extension (spike S-05). Export sets the extension itself.
export function ensureExportName(
  filePath: string,
  format: ExportFormat,
  pathApi: PlatformPath = path,
): string {
  const ext = exportExtension(format).toLowerCase();
  if (pathApi.extname(filePath).toLowerCase() === ext) {
    return filePath;
  }
  return `${filePath}${exportExtension(format)}`;
}

function safeBaseName(value: string, pathApi: PlatformPath): string | null {
  const name = pathApi.basename(value);
  if (name.length < 1 || name.length > FILE_NAME_MAX) {
    return null;
  }
  if (name.includes('/') || name.includes('\\')) {
    return null;
  }
  for (const char of name) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127) {
      return null;
    }
  }
  return name;
}

export function exportNameFromPath(filePath: string, pathApi: PlatformPath = path): string | null {
  return safeBaseName(pathApi.basename(filePath), pathApi);
}

export function defaultExportPath(
  sourcePath: string | null,
  format: ExportFormat,
  documentsDirectory: string,
  privateRoots: readonly string[],
  pathApi: PlatformPath = path,
): string | undefined {
  if (sourcePath !== null && sourcePath.length > 0) {
    const base = pathApi.basename(sourcePath, pathApi.extname(sourcePath));
    const directory = pathApi.dirname(sourcePath);
    return pathApi.join(directory, exportFileName(base, format));
  }
  const directory = defaultDocumentDirectory({
    documents: documentsDirectory,
    privateRoots,
    pathApi,
  });
  if (!directory.ok) {
    return undefined;
  }
  return pathApi.join(directory.directory, exportFileName(UNTITLED_EXPORT_BASE, format));
}