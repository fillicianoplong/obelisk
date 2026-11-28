import type { ContextBridgeLike } from './bridge.js';

declare global {
  interface Window {
  obeliskE2e?: {
    openDocument?: boolean;
  };
  }
}

export const E2E_OPEN_DOCUMENT_ARG = '--obelisk-e2e-document';

export function installE2eBridge(bridge: ContextBridgeLike, argv: readonly string[]): void {
  const fromEnv = process.env.OBELISK_E2E_DOCUMENT === '1';
  bridge.exposeInMainWorld('obeliskE2e', {
    openDocument: fromEnv || argv.includes(E2E_OPEN_DOCUMENT_ARG),
  });
}