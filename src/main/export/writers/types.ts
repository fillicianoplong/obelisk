import type { DocumentMessage, ExportAssets } from '../../../shared/ipc/types.js';

export interface ExportTarget {
  filePath: string;
}

export interface ExportCompanionFile {
  relativePath: string;
  bytes: Uint8Array;
}

export interface ExportWriterResult {
  bytes: Uint8Array;
  formulasAsImages: boolean;
  companions?: readonly ExportCompanionFile[];
}

export interface ExportWriter {
  write(
    document: DocumentMessage,
    assets: ExportAssets,
    target: ExportTarget,
  ): Promise<ExportWriterResult> | ExportWriterResult;
}