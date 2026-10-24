const ALLOWED_PROTOCOLS = new Set(['app:', 'data:', 'blob:']);

export function isAllowedRequestUrl(rawUrl: string): boolean {
  try {
    return ALLOWED_PROTOCOLS.has(new URL(rawUrl).protocol);
  } catch {
    return false;
  }
}
