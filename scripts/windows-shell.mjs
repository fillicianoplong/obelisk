import { spawnSync } from 'node:child_process';

export function powershell(body) {
  if (process.platform !== 'win32') {
    throw new Error('PowerShell is required and this process is not running on Windows.');
  }
  const encoded = Buffer.from(body, 'utf16le').toString('base64');
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
    { encoding: 'utf8' },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const detail = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    throw new Error(detail || `PowerShell exited ${result.status ?? 1}.`);
  }
  return result.stdout ?? '';
}
