import type { ExportRunRequest, ExportRunResult } from '../../shared/ipc/types.js';
import { ipcError } from '../../shared/ipc/errors.js';
import type { ExportService } from './service.js';

export function createStubExportService(): ExportService {
  return {
    run(_request: ExportRunRequest): Promise<ExportRunResult> {
      return Promise.resolve(ipcError('NOT_IMPLEMENTED', 'export:run is not available yet.'));
    },
  };
}