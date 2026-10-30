import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface WatchSummary {
  samples: number;
  seenA: number;
  seenB: number;
  missing: number;
  partial: number;
  locked: number;
  error: string | null;
}

export interface TrackedProcess {
  child: ChildProcess;
  output: () => string;
}

export function powershellExe(): string {
  const root = process.env.SystemRoot || 'C:\\Windows';
  return path.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function track(child: ChildProcess): TrackedProcess {
  let text = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    text += chunk.toString();
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    text += chunk.toString();
  });
  return {
    child,
    output: () => text.trim(),
  };
}

export function startPowerShell(scriptPath: string, args: string[]): TrackedProcess {
  const child = spawn(powershellExe(), [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    ...args,
  ], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return track(child);
}

export function startWatcher(scriptDir: string, goFile: string, summaryFile: string): TrackedProcess {
  return startPowerShell(path.join(scriptDir, 'watch-replace.ps1'), ['-Go', goFile, '-Summary', summaryFile]);
}

export function startHolder(scriptDir: string, target: string, held: string, release: string): TrackedProcess {
  return startPowerShell(path.join(scriptDir, 'hold-open.ps1'), [
    '-Target',
    target,
    '-Held',
    held,
    '-Release',
    release,
  ]);
}

export function waitExit(tracked: TrackedProcess, timeoutMs: number): Promise<number> {
  const child = tracked.child;
  return new Promise((resolve) => {
    let done = false;
    const finish = (code: number): void => {
      if (done) return;
      done = true;
      resolve(code);
    };
    const timer = setTimeout(() => {
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
      } else {
        child.kill();
      }
      finish(1);
    }, timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      finish(code ?? 1);
    });
    child.on('error', () => {
      clearTimeout(timer);
      finish(1);
    });
  });
}

export function readSummary(file: string): WatchSummary | null {
  try {
    return parseSummary(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function parseSummary(text: string): WatchSummary | null {
  const trimmed = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  const numberOr = (name: string): number => (typeof record[name] === 'number' ? record[name] : 0);
  return {
    samples: numberOr('samples'),
    seenA: numberOr('seenA'),
    seenB: numberOr('seenB'),
    missing: numberOr('missing'),
    partial: numberOr('partial'),
    locked: numberOr('locked'),
    error: typeof record.error === 'string' && record.error.length > 0 ? record.error : null,
  };
}

export function summaryPass(summary: WatchSummary | null): boolean {
  if (!summary || summary.error) return false;
  return summary.samples > 0
    && summary.seenA > 0
    && summary.seenB > 0
    && summary.missing === 0
    && summary.partial === 0;
}

export async function readOnlyFlag(scriptDir: string, file: string, mode: 'get' | 'on' | 'off'): Promise<string> {
  const tracked = startPowerShell(path.join(scriptDir, 'readonly.ps1'), ['-Path', file, '-Mode', mode]);
  const code = await waitExit(tracked, 15000);
  const text = tracked.output().trim();
  if (code !== 0) return `error ${text}`.trim();
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).pop() ?? '';
}
