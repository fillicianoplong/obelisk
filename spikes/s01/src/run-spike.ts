import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isManualUnpackaged } from './mode';

interface HostReport {
  ok?: boolean;
  mode?: string;
  packaged?: boolean;
  checks?: Array<{ id?: string; pass?: boolean; detail?: string }>;
}

const PAGE_FILES = ['renderer.html', 'renderer.css'];
const SCRIPTS = ['watch-replace.ps1', 'hold-open.ps1', 'readonly.ps1'];

function electronBinary(repoRoot: string): string {
  const pathFile = path.join(repoRoot, 'node_modules', 'electron', 'path.txt');
  const relative = fs.readFileSync(pathFile, 'utf8').trim();
  const binary = path.join(repoRoot, 'node_modules', 'electron', 'dist', relative);
  if (!fs.existsSync(binary)) {
    throw new Error(`The Electron binary is missing at ${binary}. Run node node_modules/electron/install.js.`);
  }
  return binary;
}

function spawnElectron(
  binary: string,
  args: string[],
  timeoutMs: number,
): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(binary, args, {
      cwd: path.resolve(__dirname, '..', '..', '..'),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    let settled = false;
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ code, stderr });
    };
    const timer = timeoutMs > 0
      ? setTimeout(() => {
        stderr += `\nTimed out after ${timeoutMs} ms.\n`;
        if (process.platform === 'win32' && child.pid) {
          spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
        } else {
          child.kill('SIGKILL');
        }
      }, timeoutMs)
      : null;
    child.stdout?.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on('error', (error) => {
      stderr += error.message;
      finish(1);
    });
    child.on('exit', (code) => finish(code ?? 1));
  });
}

async function launchElectron(
  binary: string,
  appArgs: string[],
  manual: boolean,
): Promise<{ code: number; stderr: string; usedNoSandbox: boolean }> {
  const timeoutMs = manual ? 0 : 4 * 60 * 1000;
  const first = await spawnElectron(binary, appArgs, timeoutMs);
  if (first.code === 0 || process.platform === 'win32' || !/sandbox|namespace|chrome-sandbox/i.test(first.stderr)) {
    return { ...first, usedNoSandbox: false };
  }
  console.log('Electron did not start under the sandbox helper. Retrying the host with --no-sandbox.');
  const second = await spawnElectron(binary, ['--no-sandbox', ...appArgs], timeoutMs);
  return { code: second.code, stderr: `${first.stderr}\n${second.stderr}`, usedNoSandbox: true };
}

function readReport(file: string): HostReport | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as HostReport;
  } catch {
    return null;
  }
}

function checkReport(report: HostReport | null): string | null {
  if (!report) return 'Electron did not write a report.';
  if (report.mode !== 'check') return `Expected mode check, got ${report.mode ?? 'nothing'}.`;
  if (report.packaged !== false) return 'The check run was packaged.';
  if (report.ok !== true) return 'The host report is not ok.';
  if (!Array.isArray(report.checks) || report.checks.length === 0) return 'The report has no checks.';
  const failed = report.checks.filter((item) => item.pass !== true);
  if (failed.length > 0) {
    return failed.map((item) => `${item.id ?? 'check'}: ${item.detail ?? 'failed'}`).join(' ');
  }
  return null;
}

function copyRuntime(spikeRoot: string): void {
  for (const name of PAGE_FILES) {
    fs.copyFileSync(path.join(spikeRoot, 'src', name), path.join(spikeRoot, 'dist', name));
  }
  for (const name of SCRIPTS) {
    fs.copyFileSync(path.join(spikeRoot, name), path.join(spikeRoot, 'dist', name));
  }
}

async function main(): Promise<void> {
  if (process.platform !== 'win32') {
    console.error('S-01 runs on Windows. The MSIX question is a Windows question.');
    process.exitCode = 1;
    return;
  }
  const spikeRoot = path.resolve(__dirname, '..');
  const repoRoot = path.resolve(spikeRoot, '..', '..');
  const output = path.join(spikeRoot, 'output');
  const reportPath = path.join(output, 'spike-report.json');
  const manual = isManualUnpackaged(process.env, process.argv, process.platform);
  await fs.promises.rm(output, { recursive: true, force: true });
  await fs.promises.mkdir(output, { recursive: true });
  copyRuntime(spikeRoot);

  const userData = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'obelisk-s01-user-'));
  const host = path.join(__dirname, 'host.js');
  const appArgs = [`--user-data-dir=${userData}`, host, '--report', reportPath, '--output', output];
  if (!manual) appArgs.push('--check');
  if (process.argv.includes('--devtools')) appArgs.push('--devtools');
  console.log(manual
    ? 'S-01 unpackaged window. This is not the MSIX package.'
    : 'S-01 check run. Unpackaged rename, read-only, and open cases. No MSIX install.');

  try {
    const launched = await launchElectron(electronBinary(repoRoot), appArgs, manual);
    const report = readReport(reportPath);
    if (report && !manual) {
      const withLaunch = report as HostReport & { launch?: unknown };
      withLaunch.launch = {
        hostNoSandbox: launched.usedNoSandbox,
        electronExitCode: launched.code,
        runnerNode: process.version,
        runnerPlatform: process.platform,
        stderrTail: launched.stderr.slice(-2000),
      };
      fs.writeFileSync(reportPath, `${JSON.stringify(withLaunch, null, 2)}\n`);
    }
    const problem = manual ? (report ? null : 'The window did not write a report.') : checkReport(report);
    if (problem || launched.code !== 0) {
      console.error(problem ?? `Electron exited ${launched.code}.`);
      process.exitCode = 1;
      return;
    }
    console.log(manual ? `Manual log: ${reportPath}` : `Check report: ${reportPath}`);
  } finally {
    await fs.promises.rm(userData, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
