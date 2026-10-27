import { spawn } from 'node:child_process';
import path from 'node:path';

function secondArg(argv: readonly string[]): string | null {
  const at = argv.indexOf('--second');
  if (at < 0) return null;
  const value = argv[at + 1];
  if (!value || value.startsWith('--')) return null;
  return value;
}

function main(): void {
  if (process.platform !== 'win32') {
    console.error('S-01 runs on Windows.');
    process.exitCode = 1;
    return;
  }
  const spikeRoot = path.resolve(__dirname, '..');
  const script = path.join(spikeRoot, 'install-spike.ps1');
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', 'Run'];
  const second = secondArg(process.argv);
  if (second) args.push('-Second', second);
  const child = spawn('powershell.exe', args, { stdio: 'inherit', windowsHide: false });
  child.on('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on('exit', (code) => {
    process.exitCode = code ?? 1;
  });
}

main();
