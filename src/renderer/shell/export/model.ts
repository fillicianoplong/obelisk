import type { ExportFormat } from '../../../shared/ipc/types.js';

export function exportFormatFromCommand(command: string): ExportFormat | null {
  if (command === 'export-pdf') {
    return 'pdf';
  }
  if (command === 'export-word') {
    return 'docx';
  }
  if (command === 'export-markdown') {
    return 'markdown';
  }
  return null;
}