import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { openObk, openObkBuffer, type OpenResult } from './codec';
import { assertNameRules } from './names';
import { type SampleSpec } from './samples';
import { encodeObk } from './save';

export interface CaseResult {
  id: string;
  pass: boolean;
  reason: string;
  expectedReason: string;
  zipOpened: boolean;
  entryCount: number;
  payloadsOpened: number;
  bytesRead: number;
  cappedEntryBytesRead: number | null;
  declaredUncompressedSize: number | null;
  stoppedAtCap: string | null;
  unchanged: boolean | null;
  fileBytes: number | null;
  saveIdentical: boolean | null;
  detail: string;
}

export interface RuntimeReport {
  environment: RuntimeEnvironment;
  cases: CaseResult[];
}

export interface RuntimeEnvironment {
  kind: string;
  platform: string;
  arch: string;
  osRelease: string;
  osVersion: string;
  node: string;
  electron: string | null;
  chrome: string | null;
  sandboxed: boolean | null;
  processType: string | null;
  argv: string[];
  execArgv: string[];
  commandLine: string[] | null;
  yauzl: string;
  yazl: string;
  linux: Record<string, string> | null;
  runner: Record<string, string | null>;
}

export async function runChecks(samplesDirectory: string): Promise<RuntimeReport> {
  assertNameRules();
  const specs = JSON.parse(await fs.promises.readFile(path.join(samplesDirectory, 'samples.json'), 'utf8')) as SampleSpec[];
  const cases: CaseResult[] = [];
  for (const spec of specs) {
    console.log(`open ${spec.id}`);
    cases.push(await runSample(spec));
  }
  console.log('save twice');
  cases.push(await runSave());
  return { environment: runtimeEnvironment(), cases };
}

export function comparableCases(cases: readonly CaseResult[]): unknown[] {
  return cases.map((item) => ({
    id: item.id,
    pass: item.pass,
    reason: item.reason,
    expectedReason: item.expectedReason,
    zipOpened: item.zipOpened,
    entryCount: item.entryCount,
    payloadsOpened: item.payloadsOpened,
    bytesRead: item.bytesRead,
    cappedEntryBytesRead: item.cappedEntryBytesRead,
    declaredUncompressedSize: item.declaredUncompressedSize,
    stoppedAtCap: item.stoppedAtCap,
    unchanged: item.unchanged,
    fileBytes: item.fileBytes,
    saveIdentical: item.saveIdentical,
  }));
}

async function runSample(spec: SampleSpec): Promise<CaseResult> {
  const before = await fingerprint(spec.file);
  const opened = await openObk(spec.file);
  const after = await fingerprint(spec.file);
  return judge(spec, opened, before, after);
}

function judge(
  spec: SampleSpec,
  opened: OpenResult,
  before: Fingerprint,
  after: Fingerprint,
): CaseResult {
  const unchanged = before.size === after.size && before.sha256 === after.sha256;
  const problems: string[] = [];
  if (opened.reason !== spec.expectedReason) {
    problems.push(`reason ${opened.reason}, expected ${spec.expectedReason}`);
  }
  if (opened.zipOpened !== spec.expectedZipOpened) {
    problems.push(`zipOpened ${String(opened.zipOpened)}`);
  }
  if (!unchanged) {
    problems.push('file bytes changed');
  }
  if (before.mtimeMs !== after.mtimeMs) {
    problems.push('mtime changed');
  }
  expectEqual(problems, 'entryCount', opened.entryCount, spec.expectedEntryCount);
  expectEqual(problems, 'payloadsOpened', opened.payloadsOpened, spec.expectedPayloadsOpened);
  expectEqual(problems, 'bytesRead', opened.bytesRead, spec.expectedBytesRead);
  expectEqual(problems, 'cappedEntryBytesRead', opened.cappedEntryBytesRead, spec.expectedCappedEntryBytesRead);
  expectEqual(problems, 'stoppedAtCap', opened.stoppedAtCap, spec.expectedStoppedAtCap);
  expectEqual(problems, 'declaredUncompressedSize', opened.declaredUncompressedSize, spec.expectedDeclaredUncompressedSize);
  if (
    spec.expectedStoppedAtCap &&
    spec.realUncompressedSize !== undefined &&
    before.size >= spec.realUncompressedSize
  ) {
    problems.push(`file is ${before.size} bytes, not smaller than the real ${spec.realUncompressedSize}`);
  }
  if (
    spec.expectedStoppedAtCap &&
    spec.realUncompressedSize !== undefined &&
    opened.cappedEntryBytesRead !== null &&
    opened.cappedEntryBytesRead >= spec.realUncompressedSize
  ) {
    problems.push('read the whole bomb');
  }
  return {
    id: spec.id,
    pass: problems.length === 0,
    reason: opened.reason,
    expectedReason: spec.expectedReason,
    zipOpened: opened.zipOpened,
    entryCount: opened.entryCount,
    payloadsOpened: opened.payloadsOpened,
    bytesRead: opened.bytesRead,
    cappedEntryBytesRead: opened.cappedEntryBytesRead,
    declaredUncompressedSize: opened.declaredUncompressedSize,
    stoppedAtCap: opened.stoppedAtCap,
    unchanged,
    fileBytes: before.size,
    saveIdentical: null,
    detail: problems.length === 0 ? opened.detail : `${problems.join('; ')} (${opened.detail})`,
  };
}

function expectEqual(problems: string[], label: string, actual: unknown, expected: unknown): void {
  if (expected !== undefined && actual !== expected) {
    problems.push(`${label} ${String(actual)}, expected ${String(expected)}`);
  }
}

async function runSave(): Promise<CaseResult> {
  const images = Array.from({ length: 200 }, (_unused, index) =>
    Buffer.from(`obelisk-s08-image-${String(index).padStart(3, '0')}`),
  );
  const first = await encodeObk(images);
  const second = await encodeObk(images);
  const saveIdentical = first.equals(second);
  const opened = await openObkBuffer(first);
  const problems: string[] = [];
  if (!saveIdentical) {
    problems.push('the two saves differ');
  }
  if (!opened.ok) {
    problems.push(`open ${opened.reason}: ${opened.detail}`);
  }
  if (opened.entryCount !== 202) {
    problems.push(`entryCount ${opened.entryCount}`);
  }
  return {
    id: 'save-twice',
    pass: problems.length === 0,
    reason: opened.reason,
    expectedReason: 'ok',
    zipOpened: opened.zipOpened,
    entryCount: opened.entryCount,
    payloadsOpened: opened.payloadsOpened,
    bytesRead: opened.bytesRead,
    cappedEntryBytesRead: opened.cappedEntryBytesRead,
    declaredUncompressedSize: opened.declaredUncompressedSize,
    stoppedAtCap: opened.stoppedAtCap,
    unchanged: null,
    fileBytes: first.length,
    saveIdentical,
    detail: problems.length === 0 ? `${first.length} identical bytes` : problems.join('; '),
  };
}

interface Fingerprint {
  size: number;
  mtimeMs: number;
  sha256: string;
}

async function fingerprint(file: string): Promise<Fingerprint> {
  const stat = await fs.promises.stat(file);
  const hash = createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return { size: stat.size, mtimeMs: stat.mtimeMs, sha256: hash.digest('hex') };
}

function runtimeEnvironment(): RuntimeEnvironment {
  const proc = process as NodeJS.Process & { sandboxed?: boolean; type?: string };
  return {
    kind: proc.versions.electron ? 'electron-utility' : 'node',
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    osVersion: os.version(),
    node: process.version,
    electron: proc.versions.electron ?? null,
    chrome: proc.versions.chrome ?? null,
    sandboxed: typeof proc.sandboxed === 'boolean' ? proc.sandboxed : null,
    processType: proc.type ?? null,
    argv: process.argv,
    execArgv: process.execArgv,
    commandLine: commandLine(),
    yauzl: packageVersion('yauzl'),
    yazl: packageVersion('yazl'),
    linux: linuxStatus(),
    runner: {
      os: process.env.RUNNER_OS ?? null,
      arch: process.env.RUNNER_ARCH ?? null,
      name: process.env.RUNNER_NAME ?? null,
      image: process.env.ImageVersion ?? null,
      imageOs: process.env.ImageOS ?? null,
      runId: process.env.GITHUB_RUN_ID ?? null,
      sha: process.env.GITHUB_SHA ?? null,
      ref: process.env.GITHUB_REF ?? null,
    },
  };
}

function commandLine(): string[] | null {
  if (process.platform !== 'linux') {
    return null;
  }
  try {
    return fs.readFileSync('/proc/self/cmdline', 'utf8').split('\0').filter((part) => part.length > 0);
  } catch {
    return null;
  }
}

function packageVersion(name: string): string {
  const file = path.join(__dirname, '..', 'node_modules', name, 'package.json');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: string };
  return parsed.version ?? 'unknown';
}

function linuxStatus(): Record<string, string> | null {
  if (process.platform !== 'linux') {
    return null;
  }
  try {
    const text = fs.readFileSync('/proc/self/status', 'utf8');
    const wanted = new Set(['Seccomp', 'NoNewPrivs', 'CapEff']);
    const found: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const split = line.indexOf(':');
      if (split < 0) {
        continue;
      }
      const key = line.slice(0, split);
      if (wanted.has(key)) {
        found[key] = line.slice(split + 1).trim();
      }
    }
    return found;
  } catch {
    return null;
  }
}
