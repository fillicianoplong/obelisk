import type { DocumentMessage, ExportAssets } from '../../../shared/ipc/types.js';
import type { ExportTarget, ExportWriter, ExportWriterResult } from './types.js';

const PLACEHOLDER = '%PDF-1.4\n% Obelisk export placeholder\n%%EOF\n';

export const pdfExportWriter: ExportWriter = {
  write(_document: DocumentMessage, _assets: ExportAssets, _target: ExportTarget): ExportWriterResult {
    return {
      bytes: new TextEncoder().encode(PLACEHOLDER),
      formulasAsImages: false,
    };
  },
};