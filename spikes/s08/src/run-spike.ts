import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { comparableCases, runChecks, type CaseResult, type RuntimeReport } from './checks';
import { generateSamples } from './samples';

interface ElectronReport {
  sandboxRequested: boolean;
  forkDeclaresSandbox: boolean;
  hostNoSandbox: boolean;
  hostElectron: string | null;
  hostNode: string;
  exitCode: number;
  utility: {
    pid: number;
    type: string;
    serviceName: string | null;
    name: string | null;
    sandboxed: boolean | null;
    integrityLevel: string | null;
  } | null;
  child: RuntimeReport | null;
}

async function main(): Promise<void> {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const spikeRoot = path.resolve(__dirname, '..');
  const output = path.join(spikeRoot, 'output');
  await fs.promises.rm(output, { recursive: true, force: true });
  await fs.promises.mkdir(output, { recursive: true });
  const samples = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'obelisk-s08-'));
  const userData = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'obelisk-s08-user-'));
  try {
    console.log(`Samples: ${samples}`);
    await generateSamples(samples);
    console.log('Node');
    const nodeReport = await runChecks(samples);
    await fs.promises.writeFile(path.join(output, 'node.json'), `${JSON.stringify(nodeReport, null, 2)}\n`);

    const binary = electronBinary(repoRoot);
    const host = path.join(__dirname, 'utility-host.js');
    const electronReportPath = path.join(output, 'electron.json');
    console.log(`Electron ${binary}`);
    const launched = await launchElectron(binary, host, samples, electronReportPath, userData);
    const electronReport = readElectronReport(electronReportPath);
    const summary = summarize(nodeReport, electronReport, launched);
    await fs.promises.writeFile(path.join(output, 'spike-report.json'), `${JSON.stringify(summary, null, 2)}\n`);
    printSummary(summary);
    if (!summary.ok) {
      process.exitCode = 1;
    }
  } finally {
    await fs.promises.rm(samples, { recursive: true, force: true });
    await fs.promises.rm(userData, { recursive: true, force: true });
  }
}

function summarize(
  nodeReport: RuntimeReport,
  electronReport: ElectronReport | null,
  launched: LaunchResult,
): Record<string, unknown> {
  const electronCases = electronReport?.child?.cases ?? null;
  const sameResults =
    electronCases !== null &&
    JSON.stringify(comparableCases(nodeReport.cases)) === JSON.stringify(comparableCases(electronCases));
  const nodePass = nodeReport.cases.every((item) => item.pass);
  const electronPass = electronCases !== null && electronCases.every((item) => item.pass);
  const utility = electronReport?.utility ?? null;
  const childEnv = electronReport?.child?.environment ?? null;
  return {
    ok: launched.code === 0 && nodePass && electronPass && sameResults && electronReport !== null,
    sameResults,
    nodePass,
    electronPass,
    electronExitCode: launched.code,
    hostNoSandbox: launched.usedNoSandbox,
    sandbox: {
      requested: true,
      forkOptionInElectron45Types: false,
      utilityProcessType: utility?.type ?? null,
      utilityServiceName: utility?.serviceName ?? null,
      metricSandboxed: utility?.sandboxed ?? null,
      integrityLevel: utility?.integrityLevel ?? null,
      utilityName: utility?.name ?? null,
      childSandboxed: childEnv?.sandboxed ?? null,
      childProcessType: childEnv?.processType ?? null,
      childSeccomp: childEnv?.linux?.Seccomp ?? null,
      childNoNewPrivs: childEnv?.linux?.NoNewPrivs ?? null,
    },
    node: {
      version: nodeReport.environment.node,
      platform: nodeReport.environment.platform,
      osRelease: nodeReport.environment.osRelease,
      osVersion: nodeReport.environment.osVersion,
      yauzl: nodeReport.environment.yauzl,
      yazl: nodeReport.environment.yazl,
      seccomp: nodeReport.environment.linux?.Seccomp ?? null,
      runner: nodeReport.environment.runner,
    },
    electron: {
      version: childEnv?.electron ?? electronReport?.hostElectron ?? null,
      node: childEnv?.node ?? electronReport?.hostNode ?? null,
      chrome: childEnv?.chrome ?? null,
      platform: childEnv?.platform ?? null,
      osRelease: childEnv?.osRelease ?? null,
      osVersion: childEnv?.osVersion ?? null,
      yauzl: childEnv?.yauzl ?? null,
      yazl: childEnv?.yazl ?? null,
      argv: childEnv?.argv ?? null,
      execArgv: childEnv?.execArgv ?? null,
      commandLine: childEnv?.commandLine ?? null,
      runner: childEnv?.runner ?? null,
    },
    failures: failures(nodeReport.cases, electronCases),
    cases: {
      node: comparableCases(nodeReport.cases),
      electron: electronCases ? comparableCases(electronCases) : null,
    },
    launchStderr: launched.stderr.slice(-4000),
  };
}

function failures(nodeCases: readonly CaseResult[], electronCases: readonly CaseResult[] | null): unknown[] {
  const rows: unknown[] = [];
  for (const item of nodeCases) {
    if (!item.pass) {
      rows.push({ runtime: 'node', id: item.id, detail: item.detail });
    }
  }
  for (const item of electronCases ?? []) {
    if (!item.pass) {
      rows.push({ runtime: 'electron', id: item.id, detail: item.detail });
    }
  }
  return rows;
}

function printSummary(summary: Record<string, unknown>): void {
  console.log(JSON.stringify({
    ok: summary.ok,
    sameResults: summary.sameResults,
    nodePass: summary.nodePass,
    electronPass: summary.electronPass,
    sandbox: summary.sandbox,
    node: summary.node,
    electron: summary.electron,
    failures: summary.failures,
  }, null, 2));
}

interface LaunchResult {
  code: number;
  stderr: string;
  usedNoSandbox: boolean;
}

async function launchElectron(
  binary: string,
  host: string,
  samples: string,
  reportPath: string,
  userData: string,
): Promise<LaunchResult> {
  const appArgs = [`--user-data-dir=${userData}`, host, '--samples', samples, '--report', reportPath];
  const first = await spawnElectron(binary, appArgs);
  if (first.code === 0 || process.platform === 'win32' || !/sandbox|namespace|chrome-sandbox/i.test(first.stderr)) {
    return { ...first, usedNoSandbox: false };
  }
  console.log('Electron did not start under the sandbox helper. Retrying the host with --no-sandbox.');
  const second = await spawnElectron(binary, ['--no-sandbox', ...appArgs]);
  return { code: second.code, stderr: `${first.stderr}\n${second.stderr}`, usedNoSandbox: true };
}

function spawnElectron(binary: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(binary, args, {
      cwd: path.resolve(__dirname, '..', '..', '..'),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    const timer = setTimeout(() => {
      stderr += '\nTimed out after 10 minutes.\n';
      if (process.platform === 'win32' && child.pid) {
        spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
      } else {
        child.kill('SIGKILL');
      }
    }, 10 * 60 * 1000);
    child.stdout?.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: 1, stderr: `${stderr}${error.message}` });
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stderr });
    });
  });
}

function readElectronReport(file: string): ElectronReport | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as ElectronReport;
  } catch {
    return null;
  }
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

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
