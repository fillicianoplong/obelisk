import path from 'node:path';

/** Explorer and second-instance argv can include Chromium switches before paths. */
const FLAG_WITH_VALUE = new Set(['--output', '--report']);

export const LAUNCH_FILE_MAX = 20;

export function candidatePathsFromArgv(argv: readonly string[]): string[] {
  const files: string[] = [];
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg.startsWith('-')) {
      if (FLAG_WITH_VALUE.has(arg)) {
        index += 1;
      }
      continue;
    }
    if (/\.(?:js|mjs|cjs)$/i.test(arg)) {
      continue;
    }
    files.push(arg);
  }
  return files;
}

export function isObkLaunchPath(filePath: string): boolean {
  return path.win32.extname(filePath).toLowerCase() === '.obk';
}

export function launchPathsFromArgv(argv: readonly string[]): string[] {
  return candidatePathsFromArgv(argv)
    .filter(isObkLaunchPath)
    .slice(0, LAUNCH_FILE_MAX);
}
