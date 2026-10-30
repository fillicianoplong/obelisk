const FLAG_WITH_VALUE = new Set(['--output', '--report']);

export function fileArguments(argv: readonly string[]): string[] {
  const files: string[] = [];
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg.startsWith('-')) {
      if (FLAG_WITH_VALUE.has(arg)) i += 1;
      continue;
    }
    if (/\.(?:js|mjs|cjs)$/i.test(arg)) continue;
    files.push(arg);
  }
  return files;
}

export function samePath(left: string, right: string, platform: NodeJS.Platform = process.platform): boolean {
  if (!left || !right) return false;
  return platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

export function pathParserProblems(): string[] {
  const problems: string[] = [];
  const cafe = `Lesson 04 ${String.fromCharCode(0x2014)} caf${String.fromCharCode(0x00e9)}.s02obk`;
  const sample = fileArguments([
    'ObeliskSpikeS02.exe',
    '--output',
    'C:\\out',
    '--expect-second',
    `C:\\Docs\\${cafe}`,
    '--devtools',
  ]);
  if (sample.length !== 1 || sample[0] !== `C:\\Docs\\${cafe}`) {
    problems.push(`path parser missed the spaced name: ${JSON.stringify(sample)}`);
  }
  const three = fileArguments(['exe', 'a.s02obk', 'b.s02obk', 'c.s02obk']);
  if (three.length !== 3) problems.push(`path parser kept ${three.length} of 3 files`);
  const script = fileArguments(['exe', 'C:\\app\\host.js', 'C:\\notes\\a.s02obk']);
  if (script.length !== 1 || script[0] !== 'C:\\notes\\a.s02obk') {
    problems.push(`path parser kept the script: ${JSON.stringify(script)}`);
  }
  const report = fileArguments(['exe', '--report', 'C:\\out\\spike-report.json', 'C:\\a.s02obk']);
  if (report.length !== 1 || report[0] !== 'C:\\a.s02obk') {
    problems.push(`path parser kept the report path: ${JSON.stringify(report)}`);
  }
  return problems;
}
