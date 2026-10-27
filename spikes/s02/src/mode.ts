export function isCi(env: NodeJS.ProcessEnv): boolean {
  const value = env.CI;
  return value !== undefined && value !== '' && value !== 'false' && value !== '0';
}

/** The Windows window. CI and every other OS only run the checks. */
export function isManualRun(
  env: NodeJS.ProcessEnv,
  argv: readonly string[],
  platform: NodeJS.Platform,
): boolean {
  return platform === 'win32' && !isCi(env) && !argv.includes('--check');
}

export function expectSecond(env: NodeJS.ProcessEnv, argv: readonly string[]): boolean {
  if (argv.includes('--expect-second')) return true;
  return env.OBELISK_S02_EXPECT_SECOND === '1';
}
