import { app, utilityProcess } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Electron 45's ForkOptions has no sandbox field. The flag is still passed so
 * the run can show whether the runtime honors it. The binding reads only the
 * keys it knows, and the utility process is launched unsandboxed.
 */
interface ForkOptionsWithSandbox {
  serviceName: string;
  stdio: 'pipe';
  env: NodeJS.ProcessEnv;
  sandbox: boolean;
}

function flag(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) {
    throw new Error(`missing ${name}`);
  }
  return value;
}

interface ProcessSnapshot {
  pid: number | null;
  utility: {
    pid: number;
    type: string;
    serviceName: string | null;
    name: string | null;
    sandboxed: boolean | null;
    integrityLevel: string | null;
  } | null;
  processes: Array<{
    pid: number;
    type: string;
    serviceName: string | null;
    name: string | null;
    sandboxed: boolean | null;
    integrityLevel: string | null;
  }>;
}

function snapshot(pid: number | undefined): ProcessSnapshot {
  const processes = app.getAppMetrics().map((metric) => ({
    pid: metric.pid,
    type: metric.type,
    serviceName: metric.serviceName ?? null,
    name: metric.name ?? null,
    sandboxed: metric.sandboxed ?? null,
    integrityLevel: metric.integrityLevel ?? null,
  }));
  const utility = pid === undefined ? null : processes.find((metric) => metric.pid === pid) ?? null;
  return { pid: pid ?? null, utility, processes };
}

function main(): void {
  const samples = flag('--samples');
  const reportPath = flag('--report');
  const childReport = `${reportPath}.child.json`;
  const childScript = path.join(__dirname, 'utility-child.js');
  const spikeModules = path.join(__dirname, '..', 'node_modules');
  const options: ForkOptionsWithSandbox = {
    serviceName: 'obk-decode',
    stdio: 'pipe',
    env: { ...process.env, NODE_PATH: spikeModules },
    sandbox: true,
  };
  const snapshots: ProcessSnapshot[] = [];
  const child = utilityProcess.fork(
    childScript,
    ['--samples', samples, '--report', childReport],
    options as unknown as Parameters<typeof utilityProcess.fork>[2],
  );

  const capture = (): void => {
    snapshots.push(snapshot(child.pid));
  };
  child.on('spawn', () => {
    capture();
    setTimeout(capture, 250);
  });
  child.stdout?.on('data', (chunk: Buffer) => {
    process.stdout.write(chunk);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(chunk);
  });
  child.on('exit', (code) => {
    capture();
    let childBody: unknown;
    try {
      childBody = JSON.parse(fs.readFileSync(childReport, 'utf8')) as unknown;
    } catch {
      childBody = null;
    }
    const utility = snapshots.find((item) => item.utility !== null)?.utility ?? null;
    const body = {
      sandboxRequested: true,
      forkDeclaresSandbox: false,
      hostNoSandbox: process.argv.includes('--no-sandbox'),
      hostElectron: process.versions.electron ?? null,
      hostNode: process.version,
      exitCode: code,
      utility,
      snapshots,
      child: childBody,
    };
    fs.writeFileSync(reportPath, `${JSON.stringify(body, null, 2)}\n`);
    app.exit(code === 0 && childBody ? 0 : code || 1);
  });
}

app.whenReady().then(() => {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    app.exit(1);
  }
});
