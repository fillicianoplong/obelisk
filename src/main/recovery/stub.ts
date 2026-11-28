import { ipcError } from '../../shared/ipc/errors.js';
import type { RecoveryDropRequest, RecoveryPutRequest, RecoveryRestoreRequest } from '../../shared/ipc/types.js';
import type { RecoveryService } from './service.js';

export function createStubRecoveryService(): RecoveryService {
  return {
    put(_request: RecoveryPutRequest) {
      return Promise.resolve(ipcError('NOT_IMPLEMENTED', 'recovery:put is not available yet.'));
    },
    list() {
      return Promise.resolve(ipcError('NOT_IMPLEMENTED', 'recovery:list is not available yet.'));
    },
    restore(_request: RecoveryRestoreRequest) {
      return Promise.resolve(ipcError('NOT_IMPLEMENTED', 'recovery:restore is not available yet.'));
    },
    drop(_recoveryId: RecoveryDropRequest['recoveryId']) {
      return Promise.resolve(ipcError('NOT_IMPLEMENTED', 'recovery:drop is not available yet.'));
    },
  };
}