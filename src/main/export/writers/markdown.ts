import type { DocumentMessage, ExportAssets } from '../../../shared/ipc/types.js';
import type { ExportWriter, ExportWriterResult } from './types.js';

// OBL-69 adds the real Markdown exporter behind this registration point.
const PLACEHOLDER = '# Obelisk Markdown export placeholder\n';

export const markdownExportWriter: ExportWriter = {
  write(_document: DocumentMessage, _assets: ExportAssets): ExportWriterResult {
    return {
      bytes: new TextEncoder().encode(PLACEHOLDER),
      formulasAsImages: false,
    };
  },
};