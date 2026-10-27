import './network';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkFile, libreOffice } from './checks';
import { buildFiftyPages, buildSamples, samplesList } from './documents';
import { networkCalls } from './network';

async function main(): Promise<void> {
  if (process.argv.includes('--time-only')) {
    const started = performance.now();
    const bytes = await buildFiftyPages();
    const ms = performance.now() - started;
    process.stdout.write(`MS ${ms.toFixed(1)} BYTES ${bytes.length} CALLS ${networkCalls().length}\n`);
    return;
  }

  const spikeRoot = path.resolve(__dirname, '..');
  const output = path.join(spikeRoot, 'output');
  await fs.promises.rm(output, { recursive: true, force: true });
  await fs.promises.mkdir(output, { recursive: true });

  const beforeCalls = networkCalls().length;
  const socketsBefore = ownSockets();
  const started = performance.now();
  const fifty = await buildFiftyPages();
  const fiftyMs = performance.now() - started;
  const callsDuringExport = networkCalls().slice(beforeCalls);
  const socketsAfter = ownSockets();

  const samples = await buildSamples();
  const files = [
    ...samples,
    {
      name: 'fifty-pages.docx',
      purpose: 'A 50-page Letter document. The pack time is the export time for NFR-04.',
      bytes: fifty,
    },
  ];
  for (const file of files) {
    await fs.promises.writeFile(path.join(output, file.name), file.bytes);
  }
  const list = samplesList(files);
  await fs.promises.writeFile(path.join(output, 'SAMPLES.md'), list);

  const checks = [];
  for (const file of files) {
    checks.push(await checkFile(file.name, file.bytes));
  }

  const loDir = path.join(output, 'libreoffice');
  const lo = files.map((file) => ({
    name: file.name,
    ...libreOffice(path.join(output, file.name), loDir),
  }));

  const namespace = timeInNamespace();
  const report = {
    docx: '9.14.0',
    node: process.version,
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    fiftyMs: Math.round(fiftyMs * 10) / 10,
    fiftyBytes: fifty.length,
    within10s: fiftyMs < 10000,
    networkCallsDuringExport: callsDuringExport,
    socketsBefore,
    socketsAfter,
    namespace,
    checks,
    libreOffice: lo,
  };
  await fs.promises.writeFile(path.join(output, 'spike-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await copyArtifacts(output, files.map((file) => file.name).concat(['SAMPLES.md', 'spike-report.json']));
  printReport(report);
}

function ownSockets(): string[] {
  if (process.platform === 'win32') {
    return [];
  }
  try {
    return fs
      .readdirSync('/proc/self/fd')
      .map((fd) => {
        try {
          return fs.readlinkSync(path.join('/proc/self/fd', fd));
        } catch {
          return '';
        }
      })
      .filter((target) => target.startsWith('socket:'));
  } catch {
    return [];
  }
}

function timeInNamespace(): { available: boolean; ms: number | null; calls: number | null; detail: string } {
  if (process.platform === 'win32') {
    return { available: false, ms: null, calls: null, detail: 'unshare is not used on Windows' };
  }
  const script = path.join(__dirname, 'run-spike.js');
  const run = spawnSync('unshare', ['-r', '-n', process.execPath, script, '--time-only'], {
    encoding: 'utf8',
    timeout: 60000,
  });
  if (run.error || run.status !== 0) {
    return {
      available: false,
      ms: null,
      calls: null,
      detail: [run.error?.message, run.stderr, run.stdout].filter(Boolean).join('\n').trim() || `exit ${run.status}`,
    };
  }
  const match = /MS ([0-9.]+) BYTES \d+ CALLS (\d+)/.exec(run.stdout);
  if (!match) {
    return { available: true, ms: null, calls: null, detail: run.stdout.trim() };
  }
  return { available: true, ms: Number(match[1]), calls: Number(match[2]), detail: run.stdout.trim() };
}

async function copyArtifacts(output: string, names: readonly string[]): Promise<void> {
  const dest = '/opt/cursor/artifacts';
  try {
    await fs.promises.mkdir(dest, { recursive: true });
  } catch {
    return;
  }
  for (const name of names) {
    await fs.promises.copyFile(path.join(output, name), path.join(dest, name));
  }
}

function printReport(report: {
  fiftyMs: number;
  within10s: boolean;
  networkCallsDuringExport: readonly string[];
  socketsBefore: readonly string[];
  socketsAfter: readonly string[];
  namespace: { available: boolean; ms: number | null; calls: number | null; detail: string };
  checks: Array<{ name: string; parts: Array<{ ok: boolean; part: string; reason: string; python: string }>; notes: string[] }>;
  libreOffice: Array<{ name: string; found: boolean; ok: boolean; detail: string }>;
}): void {
  console.log(`50-page export ${report.fiftyMs} ms, within 10s: ${report.within10s}`);
  console.log(`network calls during export: ${report.networkCallsDuringExport.length}`);
  console.log(`sockets before ${report.socketsBefore.join(',') || '(none)'} after ${report.socketsAfter.join(',') || '(none)'}`);
  console.log(`namespace: ${report.namespace.detail}`);
  for (const file of report.checks) {
    const bad = file.parts.filter((part) => !part.ok);
    console.log(`${file.name}: ${file.parts.length} parts, ${bad.length} not well-formed`);
    for (const part of bad) {
      console.log(`  ${part.part}: ${part.reason}; python ${part.python}`);
    }
    for (const note of file.notes) {
      console.log(`  ${note}`);
    }
  }
  for (const file of report.libreOffice) {
    const detail = file.ok ? '' : ` (${file.detail.split('\n')[0]?.slice(0, 200) ?? ''})`;
    console.log(`libreoffice ${file.name}: found ${file.found}, ok ${file.ok}${detail}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
