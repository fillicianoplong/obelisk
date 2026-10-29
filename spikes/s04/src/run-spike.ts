import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { outcomeOf, runFacts, strictestShippable, type RunRecord } from './judge.js';

const execFileAsync = promisify(execFile);

interface PackageMeta {
  name: string;
  version: string;
  license: string | null;
  licenseFile: string | null;
}

function readPackage(dir: string): PackageMeta {
  const file = path.join(dir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    name?: string;
    version?: string;
    license?: string | { type?: string };
  };
  const license = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? null);
  const licenseFile = ['LICENSE', 'LICENSE.md', 'license', 'License'].find((name) =>
    fs.existsSync(path.join(dir, name)),
  );
  return {
    name: pkg.name ?? path.basename(dir),
    version: pkg.version ?? 'unknown',
    license,
    licenseFile: licenseFile ?? null,
  };
}

function libraryReport(spikeRoot: string): Record<string, unknown> {
  const modules = path.join(spikeRoot, 'node_modules');
  const mermaid = readPackage(path.join(modules, 'mermaid'));
  const katex = readPackage(path.join(modules, 'katex'));
  const mermaidPkg = JSON.parse(fs.readFileSync(path.join(modules, 'mermaid', 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  const direct = Object.keys(mermaidPkg.dependencies ?? {}).map((name) => {
    const nested = path.join(modules, 'mermaid', 'node_modules', name, 'package.json');
    const dir = fs.existsSync(nested) ? path.dirname(nested) : path.join(modules, name);
    const meta = readPackage(dir);
    return { ...meta, requested: mermaidPkg.dependencies?.[name] ?? null };
  });
  const nestedKatex = path.join(modules, 'mermaid', 'node_modules', 'katex');
  return {
    mermaid,
    katex,
    mermaidBundledKatex: fs.existsSync(path.join(nestedKatex, 'package.json')) ? readPackage(nestedKatex) : null,
    mermaidDirectDependencies: direct,
  };
}

function electronBinary(root: string): string {
  const pathFile = path.join(root, 'node_modules', 'electron', 'path.txt');
  const relative = fs.readFileSync(pathFile, 'utf8').trim();
  const binary = path.join(root, 'node_modules', 'electron', 'dist', relative);
  if (!fs.existsSync(binary)) {
    throw new Error(`The Electron binary is missing at ${binary}. Run node node_modules/electron/install.js.`);
  }
  return binary;
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
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stderr });
    });
  });
}

async function launchElectron(binary: string, host: string, reportPath: string, userData: string): Promise<{ code: number; stderr: string; usedNoSandbox: boolean }> {
  const appArgs = [`--user-data-dir=${userData}`, host, '--report', reportPath];
  const first = await spawnElectron(binary, appArgs);
  if (first.code === 0 || process.platform === 'win32' || !/sandbox|namespace|chrome-sandbox/i.test(first.stderr)) {
    return { ...first, usedNoSandbox: false };
  }
  console.log('Electron did not start under the sandbox helper. Retrying the host with --no-sandbox.');
  const second = await spawnElectron(binary, ['--no-sandbox', ...appArgs]);
  return { code: second.code, stderr: `${first.stderr}\n${second.stderr}`, usedNoSandbox: true };
}

async function audit(spikeRoot: string): Promise<unknown> {
  try {
    const { stdout } = await execFileAsync('npm', ['audit', '--json'], { cwd: spikeRoot, windowsHide: true });
    const parsed = JSON.parse(stdout) as { metadata?: unknown; vulnerabilities?: unknown };
    return { metadata: parsed.metadata ?? null, vulnerabilityNames: parsed.vulnerabilities ? Object.keys(parsed.vulnerabilities as object) : [] };
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout;
    if (stdout) {
      try {
        const parsed = JSON.parse(stdout) as { metadata?: unknown };
        return { metadata: parsed.metadata ?? null, failed: true };
      } catch {
        return { error: stdout.slice(0, 1000) };
      }
    }
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function main(): Promise<void> {
  const spikeRoot = path.resolve(__dirname, '..');
  const repoRoot = path.resolve(spikeRoot, '..', '..');
  const output = path.join(spikeRoot, 'output');
  await fs.promises.rm(output, { recursive: true, force: true });
  await fs.promises.mkdir(output, { recursive: true });
  const hostReport = path.join(output, 'pages.json');
  const userData = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'obelisk-s04-'));
  try {
    const launched = await launchElectron(electronBinary(repoRoot), path.join(__dirname, 'host.js'), hostReport, userData);
    const pages = fs.existsSync(hostReport)
      ? (JSON.parse(fs.readFileSync(hostReport, 'utf8')) as { runs?: RunRecord[]; harnessOk?: boolean; screenshot?: unknown; host?: unknown; preload?: unknown; metrics?: unknown; appPolicy?: string; layoutRetry?: string | null; windowOptions?: unknown })
      : null;
    const runs = (pages?.runs ?? []).filter((run): run is RunRecord => run.report !== null);
    const facts = runs.map((run) => runFacts(run));
    const bundlePath = path.join(spikeRoot, 'dist', 'bundle-meta.json');
    const summary = {
      ok: launched.code === 0 && pages?.harnessOk === true,
      outcome: runs.length > 0 ? outcomeOf(runs) : 'fail',
      shippablePolicy: strictestShippable(runs),
      hostNoSandbox: launched.usedNoSandbox,
      electronExitCode: launched.code,
      appPolicy: pages?.appPolicy ?? null,
      windowOptions: pages?.windowOptions ?? null,
      preload: pages?.preload ?? null,
      metrics: pages?.metrics ?? null,
      host: pages?.host ?? null,
      layoutRetry: pages?.layoutRetry ?? null,
      screenshot: pages?.screenshot ?? null,
      facts,
      libraries: libraryReport(spikeRoot),
      bundle: fs.existsSync(bundlePath) ? JSON.parse(fs.readFileSync(bundlePath, 'utf8')) : null,
      audit: await audit(spikeRoot),
      machine: {
        platform: process.platform,
        release: os.release(),
        version: os.version(),
        node: process.version,
      },
      launchStderr: launched.stderr.slice(-4000),
    };
    await fs.promises.writeFile(path.join(output, 'spike-report.json'), `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify({
      ok: summary.ok,
      outcome: summary.outcome,
      shippablePolicy: summary.shippablePolicy,
      hostNoSandbox: summary.hostNoSandbox,
      decisionOk: runs.find((run) => run.id === 'rewrite-nonce')?.report.decision?.ok ?? false,
      preload: summary.preload,
      host: summary.host,
      facts: summary.facts.map((fact) => ({
        id: fact.id,
        mode: fact.mode,
        flowchart: fact.flowchart,
        fraction: fact.fraction,
        mathml: fact.mathml,
        violations: fact.violations,
        dynamicCode: fact.dynamicCode,
        blockedNetwork: fact.blockedNetwork,
      })),
    }, null, 2));
    if (!summary.ok) {
      process.exitCode = 1;
    }
  } finally {
    await fs.promises.rm(userData, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
