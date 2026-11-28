/** Command-line prefix main passes into the renderer for per-session diagram style nonces. */
export const STYLE_NONCE_ARG_PREFIX = '--obelisk-style-nonce=';

export function styleNonceFromArguments(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (arg.startsWith(STYLE_NONCE_ARG_PREFIX)) {
      const value = arg.slice(STYLE_NONCE_ARG_PREFIX.length).trim();
      return value.length > 0 ? value : null;
    }
  }
  return null;
}

export function styleNonceLaunchArgument(nonce: string): string {
  return `${STYLE_NONCE_ARG_PREFIX}${nonce}`;
}