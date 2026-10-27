import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isManualRun } from './mode';

interface HostReport {
  ok?: boolean;
  mode?: string;
  dialogsOpened?: number;
  checks?: Array<{ id?: string; pass?: boolean; detail?: string }>;
  launch?: unknown;
}

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
  const timeoutMs = manual ? 0 : 3 * 60 * 1000;
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
  if (report.dialogsOpened !== 0) return `The check run opened a Save dialog ${report.dialogsOpened} time(s).`;
  if (report.ok !== true) return 'The host report is not ok.';
  if (!Array.isArray(report.checks) || report.checks.length === 0) return 'The report has no checks.';
  const failed = report.checks.filter((item) => item.pass !== true);
  if (failed.length > 0) {
    return failed.map((item) => `${item.id ?? 'check'}: ${item.detail ?? 'failed'}`).join(' ');
  }
  return null;
}

async function main(): Promise<void> {
  const spikeRoot = path.resolve(__dirname, '..');
  const repoRoot = path.resolve(spikeRoot, '..', '..');
  const output = path.join(spikeRoot, 'output');
  const reportPath = path.join(output, 'spike-report.json');
  const manual = isManualRun(process.env, process.argv, process.platform);
  await fs.promises.rm(output, { recursive: true, force: true });
  await fs.promises.mkdir(output, { recursive: true });
  fs.copyFileSync(path.join(spikeRoot, 'src', 'renderer.html'), path.join(spikeRoot, 'dist', 'renderer.html'));
  fs.copyFileSync(path.join(spikeRoot, 'src', 'renderer.css'), path.join(spikeRoot, 'dist', 'renderer.css'));

  const userData = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'obelisk-s05-user-'));
  const host = path.join(__dirname, 'host.js');
  const appArgs = [`--user-data-dir=${userData}`, host, '--report', reportPath, '--output', output];
  if (!manual) appArgs.push('--check');
  if (process.argv.includes('--devtools')) appArgs.push('--devtools');
  console.log(manual
    ? 'S-05 Windows walkthrough. A Save dialog opens for each case.'
    : 'S-05 check run. No Save dialog will open.');

  try {
    const launched = await launchElectron(electronBinary(repoRoot), appArgs, manual);
    const report = readReport(reportPath);
    if (report) {
      report.launch = {
        hostNoSandbox: launched.usedNoSandbox,
        electronExitCode: launched.code,
        runnerNode: process.version,
        runnerPlatform: process.platform,
        stderrTail: launched.stderr.slice(-2000),
      };
      fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    }
    const problem = manual ? (report ? null : 'The walkthrough did not write a report.') : checkReport(report);
    if (problem || launched.code !== 0) {
      console.error(problem ?? `Electron exited ${launched.code}.`);
      process.exitCode = 1;
      return;
    }
    console.log(manual
      ? `Manual log: ${reportPath}`
      : `Check report: ${reportPath}`);
  } finally {
    await fs.promises.rm(userData, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
