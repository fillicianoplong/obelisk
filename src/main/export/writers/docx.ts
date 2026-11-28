import type { DocumentMessage, ExportAssets } from '../../../shared/ipc/types.js';
import type { ExportTarget, ExportWriter, ExportWriterResult } from './types.js';

// OBL-67 adds the real Word exporter behind this registration point.
const PLACEHOLDER = 'Obelisk Word export placeholder';

export const docxExportWriter: ExportWriter = {
  write(_document: DocumentMessage, _assets: ExportAssets, _target: ExportTarget): ExportWriterResult {
    return {
      bytes: new TextEncoder().encode(PLACEHOLDER),
      formulasAsImages: false,
    };
  },
};