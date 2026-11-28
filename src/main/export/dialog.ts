import type { ExportFormat } from '../../shared/ipc/types.js';
import type { DialogFilter } from '../file/openDialog.js';
import type { SaveDialogOptions } from '../file/saveDialog.js';
import { exportFormatSpec } from './formats.js';

export const EXPORT_DIALOG_TITLE = 'Export';

export function exportDialogFilters(format: ExportFormat): DialogFilter[] {
  const spec = exportFormatSpec(format);
  return [{ name: spec.filterName, extensions: [spec.extension] }];
}

export function exportDialogOptions(format: ExportFormat, defaultPath?: string): SaveDialogOptions {
  const options: SaveDialogOptions = {
    title: EXPORT_DIALOG_TITLE,
    filters: exportDialogFilters(format),
  };
  if (defaultPath !== undefined && defaultPath.length > 0) {
    options.defaultPath = defaultPath;
  }
  return options;
}