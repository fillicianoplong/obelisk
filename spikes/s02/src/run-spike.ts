import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { manifestProblems, readmeProblems, readText, rendererProblems } from './checks';
import { isManualRun } from './mode';
import { fileArguments, pathParserProblems } from './paths';

interface ActivationRecord {
  argv?: string[];
  paths?: string[];
  workingDirectory?: string | null;
  additionalData?: { spike?: string; pid?: number } | null;
}

interface HostReport {
  ok?: boolean | null;
  mode?: string;
  listening?: boolean;
  gotLock?: boolean;
  windowsOpened?: number;
  pid?: number;
  coldStart?: ActivationRecord;
  secondInstances?: ActivationRecord[];
  checks?: Array<{ id?: string; pass?: boolean; detail?: string }>;
  walkthroughCapture?: { ok?: boolean; bytes?: number; error?: string } | null;
  walkthroughPainted?: boolean | null;
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGKILL');
}

function startElectron(
  binary: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
): { child: ChildProcess; stderr: () => string } {
  const child = spawn(binary, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    process.stdout.write(chunk);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
    process.stderr.write(chunk);
  });
  return { child, stderr: () => stderr };
}

function sameDir(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function readReport(file: string): HostReport | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as HostReport;
  } catch {
    return null;
  }
}

function hasPath(record: ActivationRecord | undefined, filePath: string): boolean {
  if (!record) return false;
  const wanted = process.platform === 'win32' ? filePath.toLowerCase() : filePath;
  const values = [...(record.argv ?? []), ...(record.paths ?? [])];
  return values.some((value) => (process.platform === 'win32' ? value.toLowerCase() : value) === wanted);
}

async function waitFor(file: string, ready: (report: HostReport) => boolean, timeoutMs: number, child: ChildProcess): Promise<HostReport> {
  const started = Date.now();
  let last: HostReport | null;
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) break;
    last = readReport(file);
    if (last && ready(last)) return last;
    await delay(200);
  }
  last = readReport(file);
  if (last && ready(last)) return last;
  throw new Error(`Timed out waiting for ${file}. exit=${String(child.exitCode)} report=${JSON.stringify(last)}`);
}

function exitCode(child: ChildProcess, timeoutMs: number): Promise<number> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    const finish = (code: number): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(code);
    };
    if (child.exitCode !== null) {
      finish(child.exitCode);
      return;
    }
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        killTree(child);
        finish(1);
      }, timeoutMs);
    }
    child.on('error', () => finish(1));
    child.on('exit', (code) => finish(code ?? 1));
  });
}

function assertStatic(spikeRoot: string): void {
  const parser = pathParserProblems();
  if (parser.length > 0) throw new Error(parser.join(' '));
  const manifest = readText(path.join(spikeRoot, 'AppxManifest.xml'));
  if (!manifest) throw new Error('AppxManifest.xml is missing.');
  const manifestErrors = manifestProblems(manifest);
  if (manifestErrors.length > 0) throw new Error(manifestErrors.join(' '));
  const readme = readText(path.join(spikeRoot, 'README.md'));
  if (!readme) throw new Error('README.md is missing.');
  const readmeErrors = readmeProblems(readme);
  if (readmeErrors.length > 0) throw new Error(readmeErrors.join(' '));
  const renderer = readText(path.join(spikeRoot, 'src', 'renderer.ts'));
  if (!renderer) throw new Error('renderer.ts is missing.');
  const rendererErrors = rendererProblems(renderer);
  if (rendererErrors.length > 0) throw new Error(rendererErrors.join(' '));
  if (fileArguments(['exe', 'a.s02obk']).length !== 1) throw new Error('fileArguments failed the smoke check.');
}

function checkReport(report: HostReport | null, coldFile: string, secondFile: string): string | null {
  if (!report) return 'Electron did not write a report.';
  if (report.mode !== 'check') return `Expected mode check, got ${report.mode ?? 'nothing'}.`;
  if (report.ok !== true) return 'The host report is not ok.';
  if (report.gotLock !== true) return 'The first process did not hold the lock.';
  if (report.windowsOpened !== 1) return `windowsOpened is ${String(report.windowsOpened)}.`;
  if (!hasPath(report.coldStart, coldFile)) return `Cold start did not include ${coldFile}. argv=${JSON.stringify(report.coldStart?.argv)}`;
  const second = (report.secondInstances ?? []).find((item) => hasPath(item, secondFile));
  if (!second) return `second-instance did not include ${secondFile}. events=${JSON.stringify(report.secondInstances)}`;
  if (!second.workingDirectory) return 'second-instance workingDirectory is empty.';
  if (second.additionalData?.spike !== 's02') return `additionalData.spike is ${String(second.additionalData?.spike)}.`;
  if (second.additionalData?.pid === report.pid) return 'additionalData.pid is the primary pid.';
  const failed = (report.checks ?? []).filter((item) => item.pass !== true);
  if (failed.length > 0) return failed.map((item) => `${item.id ?? 'check'}: ${item.detail ?? 'failed'}`).join(' ');
  const secondCheck = (report.checks ?? []).find((item) => item.id === 'second-instance');
  if (!secondCheck?.pass) return 'The second-instance check did not pass.';
  if (process.platform === 'win32' && report.walkthroughCapture?.ok !== true) {
    return `walkthrough.png was not written (${report.walkthroughCapture?.error ?? 'no capture'}).`;
  }
  if (report.walkthroughPainted === false) return 'The window was a dark frame.';
  return null;
}

async function runCheck(
  binary: string,
  host: string,
  output: string,
  reportPath: string,
  coldFile: string,
  secondFile: string,
  extraArgs: string[],
): Promise<{ code: number; stderr: string; error: string | null }> {
  const userData = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'obelisk-s02-user-'));
  let secondCwd = '';
  const launchCwd = path.resolve(__dirname, '..', '..', '..');
  const baseArgs = [...extraArgs, `--user-data-dir=${userData}`, host, '--output', output, '--report', reportPath];
  const firstEnv: NodeJS.ProcessEnv = {
    ...process.env,
    OBELISK_S02_OUTPUT: output,
    OBELISK_S02_EXPECT_SECOND: '1',
    OBELISK_S02_SECOND_FILE: secondFile,
  };
  const first = startElectron(binary, [...baseArgs, '--expect-second', coldFile], firstEnv, launchCwd);
  let stderr = '';
  try {
    await waitFor(
      reportPath,
      (report) => report.listening === true && hasPath(report.coldStart, coldFile),
      60000,
      first.child,
    );
    secondCwd = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'obelisk-s02-cwd-'));
    const secondEnv: NodeJS.ProcessEnv = { ...process.env, OBELISK_S02_OUTPUT: output };
    delete secondEnv.OBELISK_S02_EXPECT_SECOND;
    delete secondEnv.OBELISK_S02_SECOND_FILE;
    const second = startElectron(binary, [...baseArgs, secondFile], secondEnv, secondCwd);
    const secondCode = await exitCode(second.child, 30000);
    stderr += second.stderr();
    if (secondCode !== 0) {
      killTree(first.child);
      return { code: secondCode, stderr: stderr + first.stderr(), error: `The second process exited ${secondCode}.` };
    }
    const arrived = await waitFor(
      reportPath,
      (report) => (report.secondInstances ?? []).some((item) => hasPath(item, secondFile)),
      30000,
      first.child,
    );
    const arrivedSecond = (arrived.secondInstances ?? []).find((item) => hasPath(item, secondFile));
    if (!arrivedSecond?.workingDirectory || !sameDir(arrivedSecond.workingDirectory, secondCwd)) {
      killTree(first.child);
      return {
        code: 1,
        stderr: stderr + first.stderr(),
        error: `workingDirectory was ${arrivedSecond?.workingDirectory ?? 'empty'}, expected ${secondCwd}.`,
      };
    }
    const firstCode = await exitCode(first.child, 30000);
    stderr += first.stderr();
    const problem = checkReport(readReport(reportPath), coldFile, secondFile);
    if (problem) return { code: 1, stderr, error: problem };
    if (firstCode !== 0) return { code: firstCode, stderr, error: `The first process exited ${firstCode}.` };
    const stampPath = path.join(output, 'second-process.json');
    const stamp = readReport(stampPath) as (HostReport & { paths?: string[]; argv?: string[] }) | null;
    if (!stamp || stamp.gotLock !== false) return { code: 1, stderr, error: 'second-process.json did not record gotLock false.' };
    if (!hasPath(stamp, secondFile)) return { code: 1, stderr, error: 'second-process.json does not contain the second file.' };
    return { code: 0, stderr, error: null };
  } catch (error) {
    killTree(first.child);
    return {
      code: 1,
      stderr: stderr + first.stderr(),
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await fs.promises.rm(userData, { recursive: true, force: true });
    if (secondCwd) await fs.promises.rm(secondCwd, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const spikeRoot = path.resolve(__dirname, '..');
  const repoRoot = path.resolve(spikeRoot, '..', '..');
  const launchCwd = repoRoot;
  const output = path.join(spikeRoot, 'output');
  const reportPath = path.join(output, 'spike-report.json');
  const manual = isManualRun(process.env, process.argv, process.platform);
  assertStatic(spikeRoot);
  await fs.promises.rm(output, { recursive: true, force: true });
  await fs.promises.mkdir(output, { recursive: true });
  fs.copyFileSync(path.join(spikeRoot, 'src', 'renderer.html'), path.join(spikeRoot, 'dist', 'renderer.html'));
  fs.copyFileSync(path.join(spikeRoot, 'src', 'renderer.css'), path.join(spikeRoot, 'dist', 'renderer.css'));

  const binary = electronBinary(repoRoot);
  const host = path.join(__dirname, 'host.js');
  if (manual) {
    const userData = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'obelisk-s02-user-'));
    const forwarded = process.argv.filter((arg) => arg === '--devtools');
    const child = startElectron(
      binary,
      [...forwarded, `--user-data-dir=${userData}`, host, '--output', output, '--report', reportPath],
      process.env,
      launchCwd,
    );
    const code = await exitCode(child.child, 0);
    await fs.promises.rm(userData, { recursive: true, force: true });
    process.exitCode = code;
    return;
  }

  const coldFile = path.join(output, 'ci-cold.s02obk');
  const secondFile = path.join(output, 'ci second.s02obk');
  fs.writeFileSync(coldFile, 's02 ci cold\n');
  fs.writeFileSync(secondFile, 's02 ci second\n');
  const firstTry = await runCheck(binary, host, output, reportPath, coldFile, secondFile, []);
  if (firstTry.error && process.platform !== 'win32' && /sandbox|namespace|chrome-sandbox/i.test(firstTry.stderr)) {
    console.log('Electron did not start under the sandbox helper. Retrying the host with --no-sandbox.');
    await fs.promises.rm(reportPath, { force: true });
    const secondTry = await runCheck(binary, host, output, reportPath, coldFile, secondFile, ['--no-sandbox']);
    if (secondTry.error) throw new Error(secondTry.error);
    return;
  }
  if (firstTry.error) throw new Error(firstTry.error);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
