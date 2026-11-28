import { styleNonceFromArguments } from '../shared/style-nonce.js';

export const STYLE_NONCE_BRIDGE_KEY = 'obeliskStyleNonce';

export interface StyleNonceBridge {
  exposeInMainWorld(apiKey: string, api: unknown): void;
}

export function installStyleNonceBridge(bridge: StyleNonceBridge, argv: readonly string[]): string {
  const nonce = styleNonceFromArguments(argv) ?? '';
  bridge.exposeInMainWorld(STYLE_NONCE_BRIDGE_KEY, nonce);
  return nonce;
}