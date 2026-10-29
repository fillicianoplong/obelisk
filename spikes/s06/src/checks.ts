import fs from 'node:fs';
import path from 'node:path';
import { GifReader } from 'omggif';
import { naiveGifSeparatorCount, walkGif } from './gif-walk';
import type { ImageWalk, WalkFrame } from './image-info';
import { assess } from './limits';
import { encodePng, readPng } from './png';
import type { Sample } from './samples';
import { naiveAnmfCount, walkWebp } from './webp-walk';
import { loadWebp } from './webp-lib';

export interface CaseResult {
  id: string;
  pass: boolean;
  detail: string;
  ok: boolean;
  reason: string | null;
  canvasWidth: number;
  canvasHeight: number;
  frameCount: number;
  accept: boolean;
  reasons: string[];
  pixelCount: string;
  elapsedMs: number;
  heapDelta: number;
}

export async function runNodeChecks(samples: readonly Sample[], spikeRoot: string): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  const pngProblems = pngSelfTest();
  results.push({
    id: 'png-reader',
    pass: pngProblems.length === 0,
    detail: pngProblems.length === 0 ? 'round-trip' : pngProblems.join('; '),
    ok: true,
    reason: null,
    canvasWidth: 2,
    canvasHeight: 2,
    frameCount: 1,
    accept: pngProblems.length === 0,
    reasons: pngProblems,
    pixelCount: '4',
    elapsedMs: 0,
    heapDelta: 0,
  });
  const sourceProblems = rendererSourceProblems(spikeRoot);
  results.push({
    id: 'renderer-source',
    pass: sourceProblems.length === 0,
    detail: sourceProblems.length === 0 ? 'no Node and no Electron imports' : sourceProblems.join('; '),
    ok: true,
    reason: null,
    canvasWidth: 0,
    canvasHeight: 0,
    frameCount: 0,
    accept: sourceProblems.length === 0,
    reasons: sourceProblems,
    pixelCount: '0',
    elapsedMs: 0,
    heapDelta: 0,
  });
  for (const sample of samples) {
    results.push(await checkSample(sample, spikeRoot));
  }
  return results;
}

async function checkSample(sample: Sample, spikeRoot: string): Promise<CaseResult> {
  const problems: string[] = [];
  const started = process.hrtime.bigint();
  const before = process.memoryUsage().heapUsed;
  const walk = sample.mime === 'image/gif' ? walkGif(sample.bytes) : walkWebp(sample.bytes);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  const heapDelta = process.memoryUsage().heapUsed - before;
  const verdict = assess(walk);
  const expect = sample.expect;
  if (walk.decodedPixelBytes !== 0) {
    problems.push('decoded pixels');
  }
  expectEqual(problems, 'ok', walk.ok, expect.ok);
  expectEqual(problems, 'reason', walk.reason, expect.reason);
  expectEqual(problems, 'canvasWidth', walk.canvasWidth, expect.canvasWidth);
  expectEqual(problems, 'canvasHeight', walk.canvasHeight, expect.canvasHeight);
  expectEqual(problems, 'frameCount', walk.frames.length, expect.frameCount);
  expectEqual(problems, 'loopCount', walk.loopCount, expect.loopCount);
  expectEqual(problems, 'repeatsForever', walk.repeatsForever, expect.repeatsForever);
  expectEqual(problems, 'animated', walk.animated, expect.animated);
  expectEqual(problems, 'accept', verdict.accept, expect.accept);
  if (verdict.reasons.join(',') !== expect.reasons.join(',')) {
    problems.push(`reasons ${verdict.reasons.join(',') || '(none)'} expected ${expect.reasons.join(',') || '(none)'}`);
  }
  if (expect.hasAlpha !== undefined && walk.hasAlpha !== expect.hasAlpha) {
    problems.push(`hasAlpha ${String(walk.hasAlpha)}`);
  }
  if (expect.framesPastContainer !== undefined && walk.framesPastContainer !== expect.framesPastContainer) {
    problems.push(`framesPastContainer ${walk.framesPastContainer}`);
  }
  for (const note of expect.notes ?? []) {
    if (!walk.notes.includes(note)) {
      problems.push(`missing note ${note}`);
    }
  }
  compareFrame(problems, 'first', walk.frames[0], expect.firstFrame);
  compareFrame(problems, 'last', walk.frames[walk.frames.length - 1], expect.lastFrame);
  if (expect.uniform) {
    walk.frames.forEach((frame, index) => compareFrame(problems, `frame ${index}`, frame, expect.uniform));
  }
  if (expect.naiveGifAbove && naiveGifSeparatorCount(sample.bytes) <= walk.frames.length) {
    problems.push('naive GIF scan did not over-count');
  }
  if (expect.naiveAnmfAbove && naiveAnmfCount(sample.bytes) <= walk.frames.length) {
    problems.push('naive ANMF scan did not over-count');
  }
  if (expect.heap) {
    if (elapsedMs > 200) {
      problems.push(`elapsed ${elapsedMs.toFixed(1)} ms`);
    }
    if (heapDelta > 8_000_000) {
      problems.push(`heap delta ${heapDelta}`);
    }
  }
  if (expect.oracle === 'omggif') {
    compareOmggif(problems, sample.bytes, walk);
  }
  if (expect.oracle === 'libwebp') {
    await compareLibwebp(problems, sample.bytes, walk, spikeRoot);
  }
  return {
    id: sample.id,
    pass: problems.length === 0,
    detail: problems.length === 0 ? sample.note : problems.join('; '),
    ok: walk.ok,
    reason: walk.reason,
    canvasWidth: walk.canvasWidth,
    canvasHeight: walk.canvasHeight,
    frameCount: walk.frames.length,
    accept: verdict.accept,
    reasons: verdict.reasons,
    pixelCount: verdict.pixelCount,
    elapsedMs,
    heapDelta,
  };
}

function compareFrame(problems: string[], label: string, frame: WalkFrame | undefined, expect: Sample['expect']['firstFrame']): void {
  if (!expect) {
    return;
  }
  if (!frame) {
    problems.push(`${label} frame missing`);
    return;
  }
  expectEqual(problems, `${label}.x`, frame.x, expect.x);
  expectEqual(problems, `${label}.y`, frame.y, expect.y);
  expectEqual(problems, `${label}.width`, frame.width, expect.width);
  expectEqual(problems, `${label}.height`, frame.height, expect.height);
  if (expect.durationMs !== undefined) {
    expectEqual(problems, `${label}.durationMs`, frame.durationMs, expect.durationMs);
  }
  if (expect.interlace !== undefined) {
    expectEqual(problems, `${label}.interlace`, frame.interlace, expect.interlace);
  }
  if (expect.transparent !== undefined) {
    expectEqual(problems, `${label}.transparent`, frame.transparent, expect.transparent);
  }
  if (expect.hasLocalPalette !== undefined) {
    expectEqual(problems, `${label}.hasLocalPalette`, frame.hasLocalPalette, expect.hasLocalPalette);
  }
}

function compareOmggif(problems: string[], bytes: Uint8Array, walk: ImageWalk): void {
  try {
    const reader = new GifReader(bytes);
    expectEqual(problems, 'omggif.width', reader.width, walk.canvasWidth);
    expectEqual(problems, 'omggif.height', reader.height, walk.canvasHeight);
    expectEqual(problems, 'omggif.frames', reader.numFrames(), walk.frames.length);
    const loop = reader.loopCount();
    if (loop !== walk.loopCount) {
      problems.push(`omggif.loop ${String(loop)} walker ${String(walk.loopCount)}`);
    }
    const count = Math.min(reader.numFrames(), walk.frames.length);
    for (let index = 0; index < count; index += 1) {
      const info = reader.frameInfo(index);
      const frame = walk.frames[index];
      if (!frame) {
        continue;
      }
      if (info.x !== frame.x || info.y !== frame.y || info.width !== frame.width || info.height !== frame.height) {
        problems.push(`omggif frame ${index} ${info.x},${info.y} ${info.width}x${info.height}`);
      }
      if (info.interlaced !== frame.interlace || info.has_local_palette !== frame.hasLocalPalette) {
        problems.push(`omggif frame ${index} flags`);
      }
      if ((info.transparent_index !== null) !== frame.transparent) {
        problems.push(`omggif frame ${index} transparency`);
      }
      if (info.delay * 10 !== frame.durationMs) {
        problems.push(`omggif frame ${index} delay ${info.delay}`);
      }
    }
  } catch (error) {
    problems.push(`omggif threw ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function compareLibwebp(problems: string[], bytes: Uint8Array, walk: ImageWalk, spikeRoot: string): Promise<void> {
  try {
    const api = await loadWebp(spikeRoot);
    if (walk.animated) {
      const frames = await api.decodeAnimation(bytes, walk.hasAlpha);
      if (!frames) {
        problems.push('libwebp animation decode returned nothing');
        return;
      }
      const copied = frames.map((frame) => ({
        width: frame.width,
        height: frame.height,
        duration: frame.duration,
      }));
      if (copied.length !== walk.frames.length) {
        problems.push(`libwebp frames ${copied.length}`);
        return;
      }
      copied.forEach((frame, index) => {
        const expected = walk.frames[index];
        if (!expected) {
          return;
        }
        const matchesFrame = frame.width === expected.bitstreamWidth && frame.height === expected.bitstreamHeight;
        const matchesCanvas = frame.width === walk.canvasWidth && frame.height === walk.canvasHeight;
        if (!matchesFrame && !matchesCanvas) {
          problems.push(`libwebp frame ${index} ${frame.width}x${frame.height}`);
        }
      });
      return;
    }
    const image = await api.decodeRGBA(bytes);
    if (!image) {
      problems.push('libwebp decode returned nothing');
      return;
    }
    if (image.width !== walk.canvasWidth || image.height !== walk.canvasHeight) {
      problems.push(`libwebp image ${image.width}x${image.height}`);
    }
  } catch (error) {
    problems.push(`libwebp threw ${error instanceof Error ? error.message : String(error)}`);
  }
}

function pngSelfTest(): string[] {
  const rgba = Uint8Array.of(255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 1, 2, 3, 128);
  const decoded = readPng(encodePng(2, 2, rgba));
  const problems: string[] = [];
  if (decoded.width !== 2 || decoded.height !== 2) {
    problems.push('png size');
  }
  for (let index = 0; index < rgba.length; index += 1) {
    if (decoded.pixels[index] !== rgba[index]) {
      problems.push(`png pixel ${index}`);
      break;
    }
  }
  return problems;
}

function rendererSourceProblems(spikeRoot: string): string[] {
  const problems: string[] = [];
  const files = [path.join(spikeRoot, 'src', 'renderer.ts'), path.join(spikeRoot, 'dist', 'renderer.js')];
  for (const file of files) {
    if (!fs.existsSync(file)) {
      problems.push(`missing ${path.basename(file)}`);
      continue;
    }
    const source = fs.readFileSync(file, 'utf8');
    if (/\brequire\s*\(/.test(source) || /from\s+['"]electron['"]/.test(source) || /from\s+['"]node:/.test(source)) {
      problems.push(`${path.basename(file)} imports Node or Electron`);
    }
  }
  const walkers = ['gif-walk.ts', 'webp-walk.ts', 'limits.ts', 'image-info.ts'];
  for (const name of walkers) {
    const source = fs.readFileSync(path.join(spikeRoot, 'src', name), 'utf8');
    if (/\brequire\s*\(/.test(source) || /from\s+['"]node:/.test(source) || /from\s+['"]electron['"]/.test(source)) {
      problems.push(`${name} is not plain JavaScript`);
    }
  }
  return problems;
}

function expectEqual(problems: string[], label: string, actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    problems.push(`${label} ${String(actual)} expected ${String(expected)}`);
  }
}
