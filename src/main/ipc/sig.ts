import type { SigDeleteRequest, SigGetRequest, SigSaveRequest } from '../../shared/ipc/types.js';
import { signatureStore } from '../signatures/index.js';

export interface SigHandlerOptions {
  userData: () => string;
}

export function handleSigList(options: SigHandlerOptions) {
  return signatureStore(options.userData()).list();
}

export function handleSigGet(request: SigGetRequest, options: SigHandlerOptions) {
  return signatureStore(options.userData()).get(request);
}

export function handleSigSave(request: SigSaveRequest, options: SigHandlerOptions) {
  return signatureStore(options.userData()).save(request);
}

export function handleSigDelete(request: SigDeleteRequest, options: SigHandlerOptions) {
  return signatureStore(options.userData()).delete(request);
}