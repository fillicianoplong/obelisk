import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runNodeChecks } from './checks';
import { readPng } from './png';
import { buildSamples, type ProbeExpect, type Sample } from './samples';

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

interface Surface {
  width: number;
  height: number;
  points: Array<{ x: number; y: number; rgba: Rgba | null }>;
  pngB64: string | null;
  error: string | null;
}

interface RenderResult {
  id: string;
  error: string | null;
  imageElement?: Surface;
  bitmap?: Surface;
  frame0?: Surface | null;
  frame1?: Surface | null;
  placed?: Surface | null;
  decoder?: {
    frameCount: number;
    repetitionCount: number | null;
    repeatsForever: boolean;
    error: string | null;
  } | null;
}

interface ElectronReport {
  error: string | null;
  noSandboxFlag: boolean;
  electron: string | null;
  chrome: string | null;
  node: string | null;
  platform: string;
  osRelease: string;
  osVersion: string;
  pageProbe: {
    hasProcess: boolean;
    hasRequire: boolean;
    hasModule: boolean;
    hasBuffer: boolean;
    hasElectron: boolean;
    userAgent: string;
  } | null;
  preloadProbe: {
    sandboxed: boolean;
    type: string;
    contextIsolated: boolean;
    electron: string;
    chrome: string;
    node: string;
  } | null;
  metrics: Array<{ pid: number; type: string; sandboxed: boolean | null; integrityLevel: string | null; name: string | null }>;
  rendererPid: number | null;
  rendererStatus: string | null;
  rendererCommand: string[] | null;
  results: RenderResult[];
}

async function main(): Promise<void> {
  const spikeRoot = path.resolve(__dirname, '..');
  const repoRoot = path.resolve(spikeRoot, '..', '..');
  const output = path.join(spikeRoot, 'output');
  await fs.promises.rm(output, { recursive: true, force: true });
  await fs.promises.mkdir(output, { recursive: true });
  const userData = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'obelisk-s06-user-'));
  const jobsPath = path.join(output, 'jobs.json');
  const electronPath = path.join(output, 'electron.json');
  try {
    console.log('Build samples');
    const built = await buildSamples(spikeRoot);
    console.log(`Samples ${built.samples.length}; libwebp ${built.encoderVersion}`);
    console.log('Node checks');
    const nodeCases = await runNodeChecks(built.samples, spikeRoot);
    await fs.promises.writeFile(path.join(output, 'node.json'), `${JSON.stringify(nodeCases, null, 2)}\n`);
    const nodeFailures = nodeCases.filter((item) => !item.pass);
    for (const failure of nodeFailures) {
      console.log(`FAIL ${failure.id}: ${failure.detail}`);
    }
    console.log(`Node ${nodeCases.length - nodeFailures.length}/${nodeCases.length}`);

    const jobs = built.samples
      .filter((sample) => sample.expect.render !== 'no')
      .map((sample) => ({
        id: sample.id,
        mime: sample.mime,
        b64: Buffer.from(sample.bytes).toString('base64'),
        canvasWidth: sample.expect.canvasWidth,
        canvasHeight: sample.expect.canvasHeight,
        frame0: sample.expect.firstFrame ?? {
          x: 0,
          y: 0,
          width: sample.expect.canvasWidth,
          height: sample.expect.canvasHeight,
        },
        points: (sample.expect.probes ?? [centerProbe(sample)]).map((probe) => ({ x: probe.x, y: probe.y })),
      }));
    await fs.promises.writeFile(jobsPath, JSON.stringify({ jobs }));

    const binary = electronBinary(repoRoot);
    const host = path.join(__dirname, 'electron-host.js');
    console.log(`Electron ${binary}`);
    const launched = await launchElectron(binary, host, jobsPath, electronPath, userData);
    const electron = readReport(electronPath);
    const renderCases = judgeRender(built.samples, electron);
    const sandbox = judgeSandbox(electron);
    const heroes = writeHeroes(output, built.samples, electron);
    const nodePass = nodeFailures.length === 0;
    const renderPass = renderCases.every((item) => item.pass);
    const outcome = !nodePass || !renderPass || !launched.ok ? 'fail' : sandbox.pass ? 'pass' : 'judgement';
    const summary = {
      outcome,
      nodePass,
      renderPass,
      sandbox,
      electronExitCode: launched.code,
      hostNoSandbox: launched.usedNoSandbox,
      encoderVersion: built.encoderVersion,
      decoderVersion: built.decoderVersion,
      libraries: [
        { name: 'omggif', version: packageVersion(spikeRoot, 'omggif'), license: 'MIT' },
        { name: 'wasm-webp', version: packageVersion(spikeRoot, 'wasm-webp'), license: 'MIT' },
        { name: 'libwebp', version: built.encoderVersion, license: 'BSD-3-Clause' },
      ],
      electron: electron
        ? {
            version: electron.electron,
            chrome: electron.chrome,
            node: electron.node,
            platform: electron.platform,
            osRelease: electron.osRelease,
            osVersion: electron.osVersion,
            noSandboxFlag: electron.noSandboxFlag,
            pageProbe: electron.pageProbe,
            preloadProbe: electron.preloadProbe,
            metrics: electron.metrics,
            rendererCommand: electron.rendererCommand,
            seccomp: seccomp(electron.rendererStatus),
          }
        : null,
      heroes,
      nodeFailures: nodeFailures.map((item) => ({ id: item.id, detail: item.detail })),
      renderFailures: renderCases.filter((item) => !item.pass),
      observations: renderCases.filter((item) => item.observe),
      launchStderr: launched.stderr.slice(-4000),
      environment: {
        node: process.version,
        platform: process.platform,
        osRelease: os.release(),
        osVersion: os.version(),
        runner: {
          os: process.env.RUNNER_OS ?? null,
          arch: process.env.RUNNER_ARCH ?? null,
          name: process.env.RUNNER_NAME ?? null,
          image: process.env.ImageVersion ?? null,
          imageOs: process.env.ImageOS ?? null,
          runId: process.env.GITHUB_RUN_ID ?? null,
          sha: process.env.GITHUB_SHA ?? null,
        },
      },
    };
    await fs.promises.writeFile(path.join(output, 'spike-report.json'), `${JSON.stringify(summary, null, 2)}\n`);
    console.log(JSON.stringify({
      outcome: summary.outcome,
      nodePass,
      renderPass,
      sandbox,
      hostNoSandbox: launched.usedNoSandbox,
      electron: summary.electron,
      nodeFailures: summary.nodeFailures,
      renderFailures: summary.renderFailures,
      observations: summary.observations,
    }, null, 2));
    if (summary.outcome === 'fail') {
      process.exitCode = 1;
    }
  } finally {
    await fs.promises.rm(userData, { recursive: true, force: true });
  }
}

function centerProbe(sample: Sample): ProbeExpect {
  return {
    x: Math.floor(sample.expect.canvasWidth / 2),
    y: Math.floor(sample.expect.canvasHeight / 2),
    rgba: [0, 0, 0, 0],
    tolerance: 255,
  };
}

function judgeRender(samples: readonly Sample[], electron: ElectronReport | null): Array<{ id: string; pass: boolean; observe: boolean; detail: string }> {
  if (!electron || electron.error) {
    return [{ id: 'electron', pass: false, observe: false, detail: electron?.error ?? 'no electron report' }];
  }
  const byId = new Map(electron.results.map((result) => [result.id, result]));
  const cases: Array<{ id: string; pass: boolean; observe: boolean; detail: string }> = [];
  for (const sample of samples) {
    if (sample.expect.render === 'no') {
      continue;
    }
    const result = byId.get(sample.id);
    const problems: string[] = [];
    if (!result) {
      problems.push('missing renderer result');
    } else if (result.error) {
      problems.push(result.error);
    } else if (sample.expect.render === 'assert') {
      assertRendered(problems, sample, result);
    }
    const detail = describe(sample, result, problems);
    cases.push({
      id: sample.id,
      pass: sample.expect.render === 'observe' ? result !== undefined && !electron.error : problems.length === 0,
      observe: sample.expect.render === 'observe',
      detail,
    });
  }
  return cases;
}

function assertRendered(problems: string[], sample: Sample, result: RenderResult): void {
  if (!result.decoder || result.decoder.error) {
    problems.push(result.decoder?.error ?? 'no ImageDecoder result');
    return;
  }
  if (result.decoder.frameCount !== sample.expect.frameCount) {
    problems.push(`ImageDecoder frames ${result.decoder.frameCount}`);
  }
  const probes = sample.expect.probes ?? [];
  const surfaces = [result.imageElement, result.bitmap, result.frame0 ?? undefined, result.placed ?? undefined];
  const png = surfaces.find((surface) => canvasPng(surface, sample));
  if (!png) {
    problems.push(`no canvas PNG ${summarizeSurfaces(surfaces)}`);
  }
  if (probes.length > 0) {
    const matched = surfaces.find((surface) => surface && surfaceMatches(surface, sample, probes));
    if (!matched) {
      problems.push(`no surface matched probes ${summarizeSurfaces(surfaces)}`);
    }
  }
  if (sample.expect.distinctFrames) {
    const first = result.frame0?.points[0]?.rgba;
    const second = result.frame1?.points[0]?.rgba;
    if (!first || !second || !distinct(first, second)) {
      problems.push(`frames not distinct ${JSON.stringify(first)} ${JSON.stringify(second)}`);
    }
  }
}

function canvasPng(surface: Surface | undefined, sample: Sample): boolean {
  if (!surface || surface.error || !surface.pngB64) {
    return false;
  }
  if (surface.width !== sample.expect.canvasWidth || surface.height !== sample.expect.canvasHeight) {
    return false;
  }
  try {
    const png = readPng(Buffer.from(surface.pngB64, 'base64'));
    return png.width === surface.width && png.height === surface.height;
  } catch {
    return false;
  }
}

function surfaceMatches(surface: Surface, sample: Sample, probes: ProbeExpect[]): boolean {
  if (surface.error || !surface.pngB64) {
    return false;
  }
  if (surface.width !== sample.expect.canvasWidth || surface.height !== sample.expect.canvasHeight) {
    return false;
  }
  let png: ReturnType<typeof readPng>;
  try {
    png = readPng(Buffer.from(surface.pngB64, 'base64'));
  } catch {
    return false;
  }
  if (png.width !== surface.width || png.height !== surface.height) {
    return false;
  }
  return probes.every((probe) => {
    const reported = surface.points.find((point) => point.x === probe.x && point.y === probe.y)?.rgba;
    const pixel = pngPixel(png.pixels, png.width, probe.x, probe.y);
    return reported !== null && reported !== undefined && near(reported, probe) && pixel !== null && near(pixel, probe);
  });
}

function pngPixel(pixels: Uint8Array, width: number, x: number, y: number): Rgba | null {
  const offset = (y * width + x) * 4;
  if (offset < 0 || offset + 3 >= pixels.length) {
    return null;
  }
  return {
    r: pixels[offset] ?? 0,
    g: pixels[offset + 1] ?? 0,
    b: pixels[offset + 2] ?? 0,
    a: pixels[offset + 3] ?? 0,
  };
}

function near(actual: Rgba, probe: ProbeExpect): boolean {
  return (
    Math.abs(actual.r - probe.rgba[0]) <= probe.tolerance &&
    Math.abs(actual.g - probe.rgba[1]) <= probe.tolerance &&
    Math.abs(actual.b - probe.rgba[2]) <= probe.tolerance &&
    Math.abs(actual.a - probe.rgba[3]) <= probe.tolerance
  );
}

function distinct(first: Rgba, second: Rgba): boolean {
  return (
    Math.abs(first.r - second.r) > 40 ||
    Math.abs(first.g - second.g) > 40 ||
    Math.abs(first.b - second.b) > 40 ||
    Math.abs(first.a - second.a) > 40
  );
}

function summarizeSurfaces(surfaces: Array<Surface | undefined>): string {
  return surfaces
    .filter((surface): surface is Surface => surface !== undefined)
    .map((surface) => `${surface.width}x${surface.height} ${surface.error ?? JSON.stringify(surface.points)}`)
    .join(' | ');
}

function describe(sample: Sample, result: RenderResult | undefined, problems: string[]): string {
  if (!result) {
    return problems.join('; ') || 'missing';
  }
  const count = result.decoder ? String(result.decoder.frameCount) : 'n/a';
  const decoderError = result.decoder?.error ? `; decoderError=${result.decoder.error}` : '';
  const extra = problems.length > 0 ? problems.join('; ') : sample.note;
  return `decoderFrames=${count}${decoderError}; ${extra}`;
}

function judgeSandbox(electron: ElectronReport | null): { pass: boolean; detail: string } {
  if (!electron || electron.error) {
    return { pass: false, detail: electron?.error ?? 'no report' };
  }
  const page = electron.pageProbe;
  const preload = electron.preloadProbe;
  const problems: string[] = [];
  if (!page) {
    problems.push('no page probe');
  } else {
    if (page.hasProcess || page.hasRequire || page.hasModule || page.hasBuffer || page.hasElectron) {
      problems.push(`page globals ${JSON.stringify(page)}`);
    }
  }
  if (!preload) {
    problems.push('no preload probe');
  } else {
    if (!preload.sandboxed) {
      problems.push('preload process.sandboxed is false');
    }
    if (preload.type !== 'renderer') {
      problems.push(`preload type ${preload.type}`);
    }
    if (!preload.contextIsolated) {
      problems.push('contextIsolation is off');
    }
  }
  const tab = electron.metrics.find((metric) => metric.pid === electron.rendererPid) ?? null;
  return {
    pass: problems.length === 0,
    detail: problems.length === 0 ? `renderer sandboxed; metric ${JSON.stringify(tab)}` : problems.join('; '),
  };
}

function writeHeroes(output: string, samples: readonly Sample[], electron: ElectronReport | null): string[] {
  if (!electron) {
    return [];
  }
  const wanted = ['gif-animated', 'webp-animated-lossless'];
  const written: string[] = [];
  for (const id of wanted) {
    const sample = samples.find((item) => item.id === id);
    const result = electron.results.find((item) => item.id === id);
    if (!sample || !result) {
      continue;
    }
    const surface = [result.imageElement, result.frame0 ?? undefined, result.placed ?? undefined].find(
      (item) => item && item.pngB64 && item.width === sample.expect.canvasWidth,
    );
    if (!surface?.pngB64) {
      continue;
    }
    const file = path.join(output, `${id}.png`);
    fs.writeFileSync(file, Buffer.from(surface.pngB64, 'base64'));
    written.push(file);
  }
  return written;
}

function seccomp(status: string | null): string | null {
  if (!status) {
    return null;
  }
  const line = status.split('\n').find((item) => item.startsWith('Seccomp:'));
  return line ? line.slice('Seccomp:'.length).trim() : null;
}

function readReport(file: string): ElectronReport | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as ElectronReport;
  } catch {
    return null;
  }
}

function packageVersion(spikeRoot: string, name: string): string {
  const parsed = JSON.parse(fs.readFileSync(path.join(spikeRoot, 'node_modules', name, 'package.json'), 'utf8')) as { version?: string };
  return parsed.version ?? 'unknown';
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

interface LaunchResult {
  code: number;
  stderr: string;
  usedNoSandbox: boolean;
  ok: boolean;
}

async function launchElectron(
  binary: string,
  host: string,
  jobs: string,
  report: string,
  userData: string,
): Promise<LaunchResult> {
  const appArgs = [`--user-data-dir=${userData}`, host, '--jobs', jobs, '--report', report];
  const first = await spawnElectron(binary, appArgs);
  if (first.code === 0 || process.platform === 'win32' || !/sandbox|namespace|chrome-sandbox|zygote/i.test(first.stderr)) {
    return { ...first, usedNoSandbox: false, ok: first.code === 0 && fs.existsSync(report) };
  }
  console.log('Electron did not start under the sandbox helper. Retrying the host with --no-sandbox.');
  const second = await spawnElectron(binary, ['--no-sandbox', ...appArgs]);
  return {
    code: second.code,
    stderr: `${first.stderr}\n${second.stderr}`,
    usedNoSandbox: true,
    ok: second.code === 0 && fs.existsSync(report),
  };
}

function spawnElectron(binary: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(binary, args, {
      cwd: path.resolve(__dirname, '..', '..', '..'),
      env: { ...process.env, DISPLAY: process.env.DISPLAY || ':1' },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    const timer = setTimeout(() => {
      stderr += '\nTimed out after 8 minutes.\n';
      child.kill('SIGKILL');
    }, 8 * 60 * 1000);
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

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
