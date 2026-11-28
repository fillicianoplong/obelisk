import type { ExportFormat } from '../../shared/ipc/types.js';

export interface ExportFormatSpec {
  format: ExportFormat;
  extension: string;
  filterName: string;
  dialogLabel: string;
}

export const EXPORT_FORMAT_SPECS: readonly ExportFormatSpec[] = [
  { format: 'pdf', extension: 'pdf', filterName: 'PDF', dialogLabel: 'PDF' },
  { format: 'docx', extension: 'docx', filterName: 'Word document', dialogLabel: 'Word' },
  { format: 'markdown', extension: 'md', filterName: 'Markdown', dialogLabel: 'Markdown' },
] as const;

const BY_FORMAT = new Map<ExportFormat, ExportFormatSpec>(
  EXPORT_FORMAT_SPECS.map((spec) => [spec.format, spec]),
);

export function exportFormatSpec(format: ExportFormat): ExportFormatSpec {
  const spec = BY_FORMAT.get(format);
  if (spec === undefined) {
    throw new Error(`Unknown export format: ${format}`);
  }
  return spec;
}