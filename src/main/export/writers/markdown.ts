import type { DocumentMessage, ExportAssets } from '../../../shared/ipc/types.js';
import { buildMarkdownExport } from '../markdown/write.js';
import type { ExportTarget, ExportWriter, ExportWriterResult } from './types.js';

export const markdownExportWriter: ExportWriter = {
  write(document: DocumentMessage, assets: ExportAssets, target: ExportTarget): ExportWriterResult {
    const built = buildMarkdownExport(document, assets, target.filePath);
    return {
      bytes: new TextEncoder().encode(built.markdown),
      formulasAsImages: false,
      companions: built.companions,
    };
  },
};