import type { DocumentMessage, ExportAssets } from '../../../shared/ipc/types.js';

export interface ExportWriterResult {
  bytes: Uint8Array;
  formulasAsImages: boolean;
}

export interface ExportWriter {
  write(document: DocumentMessage, assets: ExportAssets): Promise<ExportWriterResult> | ExportWriterResult;
}