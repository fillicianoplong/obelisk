import type { DocumentMessage, ExportAssets, ExportFormat } from '../../shared/ipc/types.js';
import { exportWriter } from './writers/index.js';
import type { ExportWriterResult } from './writers/types.js';

export interface ExportTarget {
  filePath: string;
}

// Architecture ADR-006 and OBL-65: export(format, document, assets, target).
export async function exportDocument(
  format: ExportFormat,
  document: DocumentMessage,
  assets: ExportAssets,
  target: ExportTarget,
): Promise<ExportWriterResult> {
  const writer = exportWriter(format);
  const result = await Promise.resolve(writer.write(document, assets, target));
  if (!(result.bytes instanceof Uint8Array) || !Number.isFinite(result.bytes.byteLength)) {
    throw new Error(`Export writer for ${format} did not return bytes.`);
  }
  if (target.filePath.length < 1) {
    throw new Error('Export target path is empty.');
  }
  return result;
}

export { registerExportWriter } from './writers/index.js';
export type { ExportWriter, ExportWriterResult } from './writers/types.js';