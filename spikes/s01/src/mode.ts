export type RunMode = 'check' | 'auto' | 'manual';

export function isCi(env: NodeJS.ProcessEnv): boolean {
  const value = env.CI;
  return value !== undefined && value !== '' && value !== 'false' && value !== '0';
}

/** Unpackaged Windows run with no CI and no --check. The MSIX run is separate. */
export function isManualUnpackaged(
  env: NodeJS.ProcessEnv,
  argv: readonly string[],
  platform: NodeJS.Platform,
): boolean {
  return platform === 'win32' && !isCi(env) && !argv.includes('--check');
}

export function runMode(env: NodeJS.ProcessEnv, argv: readonly string[], packaged: boolean): RunMode {
  if (packaged) {
    if (env.OBELISK_S01_AUTO === '1' || argv.includes('--auto')) return 'auto';
    return 'manual';
  }
  if (argv.includes('--check') || isCi(env)) return 'check';
  if (env.OBELISK_S01_AUTO === '1' || argv.includes('--auto')) return 'auto';
  return 'manual';
}
