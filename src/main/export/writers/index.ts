import type { ExportFormat } from '../../../shared/ipc/types.js';
import { docxExportWriter } from './docx.js';
import { markdownExportWriter } from './markdown.js';
import { pdfExportWriter } from './pdf.js';
import type { ExportWriter } from './types.js';

const WRITERS: Record<ExportFormat, ExportWriter> = {
  pdf: pdfExportWriter,
  docx: docxExportWriter,
  markdown: markdownExportWriter,
};

export function exportWriter(format: ExportFormat): ExportWriter {
  return WRITERS[format];
}

export function registerExportWriter(format: ExportFormat, writer: ExportWriter): void {
  WRITERS[format] = writer;
}