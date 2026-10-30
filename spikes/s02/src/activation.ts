import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { App } from 'electron';

export interface ProbeCall {
  name: string;
  value: unknown;
  error: string | null;
}

export interface ProbeChild {
  ran: boolean;
  kind: string | null;
  files: string[];
  stdout: string;
  error: string | null;
  note: string;
}

export interface ActivationProbe {
  at: string;
  reachableFromThisProcess: boolean;
  electronSurface: string[];
  called: ProbeCall[];
  windowsStore: boolean | null;
  isPackaged: boolean;
  hasSingleInstanceLock: boolean | null;
  method: string;
  detail: string;
  child: ProbeChild | null;
}

const PROBE_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  'try {',
  "  $null = [Windows.ApplicationModel.AppInstance, Windows.ApplicationModel, ContentType=WindowsRuntime]",
  '} catch {',
  "  Write-Output ('TYPE_LOAD ' + $_.Exception.Message)",
  '  exit 2',
  '}',
  'try {',
  '  $activated = [Windows.ApplicationModel.AppInstance]::GetActivatedEventArgs()',
  '} catch {',
  "  Write-Output ('CALL_FAILED ' + $_.Exception.Message)",
  '  exit 3',
  '}',
  'if ($null -eq $activated) {',
  "  Write-Output 'KIND null'",
  '  exit 0',
  '}',
  "Write-Output ('KIND ' + $activated.Kind)",
  'try {',
  '  $fileArgs = $activated -as [Windows.ApplicationModel.Activation.FileActivatedEventArgs]',
  '  if ($null -ne $fileArgs) {',
  '    foreach ($file in @($fileArgs.Files)) {',
  "      if ($null -ne $file -and $file.Path) { Write-Output ('FILE ' + $file.Path) }",
  '    }',
  '  }',
  '} catch {',
  "  Write-Output ('FILES_FAILED ' + $_.Exception.Message)",
  '}',
  'exit 0',
  '',
].join('\r\n');

function cloneValue(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return String(value);
  }
}

function windowsStoreFlag(): boolean | null {
  const flag = (process as NodeJS.Process & { windowsStore?: boolean }).windowsStore;
  return typeof flag === 'boolean' ? flag : null;
}

function electronSurface(app: App): string[] {
  const names = new Set<string>();
  let cursor: object | null = app;
  while (cursor && cursor !== Object.prototype) {
    for (const key of Object.getOwnPropertyNames(cursor)) {
      if (/activat|instance|protocol|windowsStore|open-file|open-url/i.test(key)) names.add(key);
    }
    cursor = Object.getPrototypeOf(cursor) as object | null;
  }
  return [...names].sort();
}

function callIfPresent(app: App, name: string): ProbeCall | null {
  const record = app as unknown as Record<string, unknown>;
  const fn = record[name];
  if (typeof fn !== 'function') return null;
  try {
    const value = (fn as () => unknown).call(app);
    return { name, value: cloneValue(value), error: null };
  } catch (error) {
    return { name, value: null, error: error instanceof Error ? error.message : String(error) };
  }
}

function runPowershell(scriptPath: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { windowsHide: true },
    );
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    };
    const timer = setTimeout(() => {
      stderr += '\nTimed out.\n';
      child.kill();
    }, 20000);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => finishFromError(error));
    child.on('close', (code) => finish(code ?? 1));

    function finishFromError(error: Error): void {
      stderr += error.message;
      finish(1);
    }
  });
}

function parseChild(stdout: string, stderr: string, code: number): ProbeChild {
  const kindLine = stdout.split(/\r?\n/).find((line) => line.startsWith('KIND '));
  const kind = kindLine ? kindLine.slice(5).trim() : null;
  const files = stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith('FILE '))
    .map((line) => line.slice(5).trim())
    .filter((line) => line.length > 0);
  const typeLoad = stdout.split(/\r?\n/).find((line) => line.startsWith('TYPE_LOAD ') || line.startsWith('CALL_FAILED '));
  const error = typeLoad ?? (code === 0 ? null : stderr.trim() || `PowerShell exited ${code}.`);
  return {
    ran: true,
    kind,
    files,
    stdout: stdout.slice(0, 4000),
    error,
    note: 'This is the child PowerShell process. GetActivatedEventArgs here is not the Electron process activation.',
  };
}

export async function probeActivation(app: App, outputDir: string): Promise<ActivationProbe> {
  const at = new Date().toISOString();
  const surface = electronSurface(app);
  const called = ['getActivatedEventArgs', 'getActivationInfo']
    .map((name) => callIfPresent(app, name))
    .filter((item): item is ProbeCall => item !== null);
  const reached = called.some((item) => item.error === null && item.value !== null && item.value !== undefined);
  let hasLock: boolean | null = null;
  if (typeof app.hasSingleInstanceLock === 'function') {
    try {
      hasLock = app.hasSingleInstanceLock();
    } catch {
      hasLock = null;
    }
  }

  let child: ProbeChild | null = null;
  if (process.platform === 'win32') {
    const scriptPath = path.join(outputDir, 'activation-probe.ps1');
    try {
      fs.mkdirSync(outputDir, { recursive: true });
      fs.writeFileSync(scriptPath, PROBE_SCRIPT);
      const result = await runPowershell(scriptPath);
      child = parseChild(result.stdout, result.stderr, result.code);
    } catch (error) {
      child = {
        ran: false,
        kind: null,
        files: [],
        stdout: '',
        error: error instanceof Error ? error.message : String(error),
        note: 'The child PowerShell process did not start.',
      };
    }
  }

  const store = windowsStoreFlag();
  const detail = reached
    ? 'An Electron method returned activation data from this process.'
    : [
        'This process cannot call Windows.ApplicationModel.AppInstance.GetActivatedEventArgs.',
        `Electron ${process.versions.electron ?? 'unknown'} does not expose that method on app.`,
        child
          ? 'A child PowerShell process was asked to call it. That result is the child process, not this one.'
          : `No child probe ran (${os.platform()}).`,
        'Reading this process activation needs a native module. This spike does not add one.',
      ].join(' ');

  return {
    at,
    reachableFromThisProcess: reached,
    electronSurface: surface,
    called,
    windowsStore: store,
    isPackaged: app.isPackaged,
    hasSingleInstanceLock: hasLock,
    method: reached ? called.map((item) => item.name).join(', ') : 'none',
    detail,
    child,
  };
}
