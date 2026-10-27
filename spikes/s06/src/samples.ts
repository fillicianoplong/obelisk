import { GifWriter } from 'omggif';
import { readChunks } from './webp-walk';
import {
  animData,
  anmfData,
  bareGif,
  chunkBytes,
  concat,
  gifExtension,
  vp8KeyHeader,
  vp8xData,
  webpFile,
  write16,
} from './craft';
import { encodeAnimationBytes, encodeBytes, loadWebp } from './webp-lib';

export type Rgba = [number, number, number, number];
export type RenderMode = 'no' | 'assert' | 'observe';

export interface FrameExpect {
  x: number;
  y: number;
  width: number;
  height: number;
  durationMs?: number;
  interlace?: boolean;
  transparent?: boolean;
  hasLocalPalette?: boolean;
}

export interface ProbeExpect {
  x: number;
  y: number;
  rgba: Rgba;
  tolerance: number;
}

export interface SampleExpect {
  ok: boolean;
  reason: string | null;
  canvasWidth: number;
  canvasHeight: number;
  frameCount: number;
  loopCount: number | null;
  repeatsForever: boolean;
  animated: boolean;
  accept: boolean;
  reasons: string[];
  hasAlpha?: boolean;
  firstFrame?: FrameExpect;
  lastFrame?: FrameExpect;
  uniform?: FrameExpect;
  framesPastContainer?: number;
  notes?: string[];
  naiveGifAbove?: boolean;
  naiveAnmfAbove?: boolean;
  oracle: 'omggif' | 'libwebp' | 'none';
  render: RenderMode;
  probes?: ProbeExpect[];
  distinctFrames?: boolean;
  heap: boolean;
}

export interface Sample {
  id: string;
  mime: 'image/gif' | 'image/webp';
  note: string;
  bytes: Uint8Array;
  expect: SampleExpect;
}

export interface BuiltSamples {
  samples: Sample[];
  encoderVersion: string;
  decoderVersion: string;
}

const RED = 0xff0000;
const BLUE = 0x0000ff;
const GREEN = 0x00ff00;
const WHITE = 0xffffff;

function solidIndex(count: number, index: number): Uint8Array {
  return new Uint8Array(count).fill(index);
}

function rgba(width: number, height: number, r: number, g: number, b: number, a = 255): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return data;
}

function encodeGif(
  width: number,
  height: number,
  frames: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    pixels: Uint8Array;
    delay?: number;
    disposal?: number;
    transparent?: number;
    palette?: number[];
  }>,
  options: { palette?: number[]; loop?: number },
): Uint8Array {
  const buf = new Uint8Array(2 * 1024 * 1024);
  const writer = new GifWriter(buf, width, height, options);
  for (const frame of frames) {
    writer.addFrame(frame.x, frame.y, frame.width, frame.height, frame.pixels, {
      delay: frame.delay,
      disposal: frame.disposal,
      transparent: frame.transparent,
      palette: frame.palette,
    });
  }
  return buf.slice(0, writer.end());
}

function manyGif(count: number): Uint8Array {
  const buf = new Uint8Array(4 * 1024 * 1024);
  const writer = new GifWriter(buf, 1, 1, { palette: [RED, BLUE], loop: 0 });
  const red = solidIndex(1, 0);
  const blue = solidIndex(1, 1);
  for (let index = 0; index < count; index += 1) {
    writer.addFrame(0, 0, 1, 1, index % 2 === 0 ? red : blue, { delay: 10 });
  }
  return buf.slice(0, writer.end());
}

function insertBeforeImage(bytes: Uint8Array, extra: Uint8Array): Uint8Array {
  const at = bytes.indexOf(0x2c);
  if (at < 0) {
    throw new Error('GIF has no image descriptor');
  }
  const out = new Uint8Array(bytes.length + extra.length);
  out.set(bytes.subarray(0, at), 0);
  out.set(extra, at);
  out.set(bytes.subarray(at), at + extra.length);
  return out;
}

function patchCanvas(bytes: Uint8Array, width: number, height: number): Uint8Array {
  const copy = bytes.slice();
  write16(copy, 6, width);
  write16(copy, 8, height);
  return copy;
}

function patchFirstFrameSize(bytes: Uint8Array, width: number, height: number): Uint8Array {
  const copy = bytes.slice();
  const at = copy.indexOf(0x2c);
  if (at < 0) {
    throw new Error('GIF has no image descriptor');
  }
  write16(copy, at + 5, width);
  write16(copy, at + 7, height);
  return copy;
}

function setInterlace(bytes: Uint8Array): Uint8Array {
  const copy = bytes.slice();
  const at = copy.indexOf(0x2c);
  const packedAt = at + 9;
  copy[packedAt] = (copy[packedAt] ?? 0) | 0x40;
  return copy;
}

function redProbe(x: number, y: number, tolerance: number): ProbeExpect {
  return { x, y, rgba: [255, 0, 0, 255], tolerance };
}

export async function buildSamples(spikeRoot: string): Promise<BuiltSamples> {
  const api = await loadWebp(spikeRoot);
  const encoderVersion = await api.encoderVersion();
  const decoderVersion = await api.decoderVersion();
  const palette = [RED, BLUE, GREEN, WHITE];
  const gifStill = encodeGif(64, 64, [{ x: 0, y: 0, width: 64, height: 64, pixels: solidIndex(64 * 64, 0) }], { palette });
  const gifAnimated = encodeGif(
    64,
    64,
    [
      { x: 0, y: 0, width: 64, height: 64, pixels: solidIndex(64 * 64, 0), delay: 100 },
      { x: 0, y: 0, width: 64, height: 64, pixels: solidIndex(64 * 64, 1), delay: 100 },
    ],
    { palette, loop: 0 },
  );
  const gifLoop = encodeGif(
    16,
    16,
    [
      { x: 0, y: 0, width: 16, height: 16, pixels: solidIndex(16 * 16, 0), delay: 50 },
      { x: 0, y: 0, width: 16, height: 16, pixels: solidIndex(16 * 16, 1), delay: 50 },
    ],
    { palette, loop: 99 },
  );
  const comment = gifExtension(0xfe, [Uint8Array.from([0x2c, 0, 0, 0, 0, 4, 0, 4, 0, 0, 8, 8])]);
  const plain = gifExtension(0x01, [new Uint8Array(12)]);
  const fakeCount = gifExtension(0xff, [Uint8Array.from('FRAMECNT1.0'.split('').map((char) => char.charCodeAt(0))), Uint8Array.of(99, 0)]);
  const half = new Uint8Array(8 * 8);
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      half[y * 8 + x] = x < 4 ? 0 : 1;
    }
  }
  const gifTransparent = encodeGif(
    8,
    8,
    [{ x: 0, y: 0, width: 8, height: 8, pixels: half, transparent: 1, delay: 100 }],
    { palette },
  );
  const gifOffset = encodeGif(
    16,
    16,
    [
      { x: 4, y: 4, width: 8, height: 8, pixels: solidIndex(8 * 8, 0), delay: 100 },
      { x: 0, y: 0, width: 16, height: 16, pixels: solidIndex(16 * 16, 1), delay: 100 },
    ],
    { palette, loop: 0 },
  );
  const gifLocal = encodeGif(
    16,
    16,
    [
      { x: 0, y: 0, width: 16, height: 16, pixels: solidIndex(16 * 16, 0), delay: 20 },
      { x: 0, y: 0, width: 16, height: 16, pixels: solidIndex(16 * 16, 0), delay: 20, palette: [GREEN, WHITE] },
    ],
    { palette, loop: 0 },
  );
  const gif1000 = manyGif(1000);
  const gif1001 = manyGif(1001);
  const outside = encodeGif(10, 10, [{ x: 8, y: 8, width: 4, height: 4, pixels: solidIndex(16, 0) }], { palette });
  const tiny = encodeGif(1, 1, [{ x: 0, y: 0, width: 1, height: 1, pixels: solidIndex(1, 0) }], { palette });
  const gif87 = tiny.slice();
  gif87[4] = 0x37;

  const red64 = rgba(64, 64, 255, 0, 0);
  const blue64 = rgba(64, 64, 0, 0, 255);
  const red8 = rgba(8, 8, 255, 0, 0);
  const lossyStill = await encodeBytes(api, red64, 64, 64, false, false);
  const losslessStill = await encodeBytes(api, red64, 64, 64, true, true);
  const lossyAlpha = await encodeBytes(api, rgba(8, 8, 255, 0, 0, 128), 8, 8, true, false);
  const losslessAlpha = await encodeBytes(api, rgba(8, 8, 255, 0, 0, 0), 8, 8, true, true);
  const odd = await encodeBytes(api, rgba(3, 5, 0, 255, 0), 3, 5, true, true);
  const animLossless = await encodeAnimationBytes(api, 64, 64, true, [
    { data: red64, duration: 200, lossless: true },
    { data: blue64, duration: 200, lossless: true },
  ]);
  const animLossy = await encodeAnimationBytes(api, 32, 32, false, [
    { data: rgba(32, 32, 255, 0, 0), duration: 200, lossless: false },
    { data: rgba(32, 32, 0, 0, 255), duration: 200, lossless: false },
  ]);
  const animAlpha = await encodeAnimationBytes(api, 8, 8, true, [
    { data: rgba(8, 8, 255, 0, 0, 128), duration: 200, lossless: true },
    { data: red8, duration: 200, lossless: true },
  ]);
  const anim1000Frames = Array.from({ length: 1000 }, (_value, index) => ({
    data: index % 2 === 0 ? rgba(1, 1, 255, 0, 0) : rgba(1, 1, 0, 0, 255),
    duration: 20,
    lossless: true,
  }));
  const anim1000 = await encodeAnimationBytes(api, 1, 1, true, anim1000Frames);
  const one = await encodeBytes(api, rgba(1, 1, 255, 0, 0), 1, 1, true, true);
  const four = await encodeBytes(api, rgba(4, 4, 255, 0, 0), 4, 4, true, true);
  const eight = await encodeBytes(api, red8, 8, 8, true, true);

  const samples: Sample[] = [
    gifSample('gif-static', 'One solid GIF frame.', gifStill, {
      ...okGif(64, 64, 1, false),
      oracle: 'omggif',
      render: 'assert',
      probes: [redProbe(32, 32, 0)],
      firstFrame: { x: 0, y: 0, width: 64, height: 64, durationMs: 0 },
      heap: false,
    }),
    gifSample('gif-animated', 'Two full-canvas GIF frames and a Netscape loop of 0.', gifAnimated, {
      ...okGif(64, 64, 2, true),
      loopCount: 0,
      repeatsForever: true,
      oracle: 'omggif',
      render: 'assert',
      probes: [redProbe(32, 32, 0)],
      distinctFrames: true,
      firstFrame: { x: 0, y: 0, width: 64, height: 64, durationMs: 1000 },
      heap: false,
    }),
    gifSample('gif-loop-lie', 'Netscape loop count 99 is not the frame count.', gifLoop, {
      ...okGif(16, 16, 2, true),
      loopCount: 99,
      oracle: 'omggif',
      render: 'assert',
      probes: [redProbe(8, 8, 0)],
      distinctFrames: true,
      heap: false,
    }),
    gifSample('gif-comment-lie', 'A comment block contains an image-separator byte.', insertBeforeImage(gifAnimated, comment), {
      ...okGif(64, 64, 2, true),
      loopCount: 0,
      repeatsForever: true,
      naiveGifAbove: true,
      oracle: 'omggif',
      render: 'assert',
      probes: [redProbe(32, 32, 0)],
      distinctFrames: true,
      heap: false,
    }),
    gifSample('gif-trailing-separator', 'Bytes after the trailer include an image separator.', concat([gifAnimated, Uint8Array.of(0x2c, 0, 0)]), {
      ...okGif(64, 64, 2, true),
      loopCount: 0,
      repeatsForever: true,
      naiveGifAbove: true,
      oracle: 'omggif',
      render: 'assert',
      probes: [redProbe(32, 32, 0)],
      heap: false,
    }),
    gifSample('gif-plain-text', 'A plain-text extension is not a frame.', insertBeforeImage(gifStill, plain), {
      ...okGif(64, 64, 1, false),
      oracle: 'none',
      render: 'assert',
      probes: [redProbe(32, 32, 0)],
      heap: false,
    }),
    gifSample('gif-app-count-lie', 'An application extension says 99. The file has two frames.', insertBeforeImage(gifLoop, fakeCount), {
      ...okGif(16, 16, 2, true),
      loopCount: 99,
      oracle: 'omggif',
      render: 'assert',
      probes: [redProbe(8, 8, 0)],
      distinctFrames: true,
      heap: false,
    }),
    gifSample('gif-interlace', 'The interlace bit is set. The walker does not reorder pixels.', setInterlace(gifStill), {
      ...okGif(64, 64, 1, false),
      oracle: 'omggif',
      render: 'assert',
      probes: [redProbe(32, 32, 0)],
      firstFrame: { x: 0, y: 0, width: 64, height: 64, interlace: true },
      heap: false,
    }),
    gifSample('gif-local-palette', 'The second frame has its own palette.', gifLocal, {
      ...okGif(16, 16, 2, true),
      loopCount: 0,
      repeatsForever: true,
      oracle: 'omggif',
      render: 'assert',
      probes: [redProbe(8, 8, 0)],
      distinctFrames: true,
      firstFrame: { x: 0, y: 0, width: 16, height: 16, hasLocalPalette: false },
      lastFrame: { x: 0, y: 0, width: 16, height: 16, hasLocalPalette: true },
      heap: false,
    }),
    gifSample('gif-transparent', 'Half of the frame uses the transparent index.', gifTransparent, {
      ...okGif(8, 8, 1, false),
      hasAlpha: true,
      oracle: 'omggif',
      render: 'assert',
      probes: [
        { x: 1, y: 4, rgba: [255, 0, 0, 255], tolerance: 0 },
        { x: 6, y: 4, rgba: [0, 0, 0, 0], tolerance: 0 },
      ],
      firstFrame: { x: 0, y: 0, width: 8, height: 8, transparent: true },
      heap: false,
    }),
    gifSample('gif-offset', 'The first frame is a sub-rectangle of the logical screen.', gifOffset, {
      ...okGif(16, 16, 2, true),
      loopCount: 0,
      repeatsForever: true,
      oracle: 'omggif',
      render: 'observe',
      probes: [
        { x: 0, y: 0, rgba: [0, 0, 0, 0], tolerance: 0 },
        { x: 8, y: 8, rgba: [255, 0, 0, 255], tolerance: 0 },
      ],
      firstFrame: { x: 4, y: 4, width: 8, height: 8 },
      heap: false,
    }),
    gifSample('gif-1000', '1,000 one-pixel frames, on the frame limit.', gif1000, {
      ...okGif(1, 1, 1000, true),
      loopCount: 0,
      repeatsForever: true,
      uniform: { x: 0, y: 0, width: 1, height: 1 },
      oracle: 'omggif',
      render: 'assert',
      probes: [redProbe(0, 0, 0)],
      distinctFrames: true,
      heap: false,
    }),
    gifSample('gif-1001', '1,001 frames. H-27.', gif1001, {
      ...okGif(1, 1, 1001, true),
      accept: false,
      reasons: ['too-many-frames'],
      loopCount: 0,
      repeatsForever: true,
      uniform: { x: 0, y: 0, width: 1, height: 1 },
      oracle: 'omggif',
      render: 'no',
      heap: false,
    }),
    gifSample('gif-frame-outside', 'A frame rectangle extends past the logical screen. H-29.', outside, {
      ...okGif(10, 10, 1, false),
      accept: false,
      reasons: ['frame-outside'],
      firstFrame: { x: 8, y: 8, width: 4, height: 4 },
      oracle: 'omggif',
      render: 'no',
      heap: false,
    }),
    gifSample('gif-huge-canvas', 'Logical screen says 65535 by 65535. The one real frame is 1 by 1.', patchCanvas(tiny, 65535, 65535), {
      ...okGif(65535, 65535, 1, false),
      accept: false,
      reasons: ['bad-canvas'],
      firstFrame: { x: 0, y: 0, width: 1, height: 1 },
      oracle: 'omggif',
      render: 'no',
      heap: true,
    }),
    gifSample('gif-huge-frame', 'The image descriptor says 65535 by 65535. The LZW payload is not expanded.', patchFirstFrameSize(encodeGif(8, 8, [{ x: 0, y: 0, width: 1, height: 1, pixels: solidIndex(1, 0) }], { palette }), 65535, 65535), {
      ...okGif(8, 8, 1, false),
      accept: false,
      reasons: ['frame-outside', 'pixel-budget'],
      firstFrame: { x: 0, y: 0, width: 65535, height: 65535 },
      oracle: 'omggif',
      render: 'no',
      heap: true,
    }),
    gifSample('gif-pixel-budget', 'Four declared 8000 by 8000 frames. 256,000,000 pixels.', bareGif({
      width: 8000,
      height: 8000,
      frames: [0, 1, 2, 3].map(() => ({ x: 0, y: 0, width: 8000, height: 8000 })),
    }), {
      ...okGif(8000, 8000, 4, true),
      accept: false,
      reasons: ['pixel-budget'],
      uniform: { x: 0, y: 0, width: 8000, height: 8000 },
      oracle: 'none',
      render: 'no',
      heap: true,
    }),
    gifSample('gif-pixel-under', 'Two declared 8000 by 8000 frames. 128,000,000 pixels, under the cap.', bareGif({
      width: 8000,
      height: 8000,
      frames: [0, 1].map(() => ({ x: 0, y: 0, width: 8000, height: 8000 })),
    }), {
      ...okGif(8000, 8000, 2, true),
      uniform: { x: 0, y: 0, width: 8000, height: 8000 },
      oracle: 'none',
      render: 'no',
      heap: false,
    }),
    gifSample('gif-missing-trailer', 'The trailer byte is removed.', gifStill.subarray(0, gifStill.length - 1), {
      ...okGif(64, 64, 1, false),
      ok: false,
      reason: 'missing-trailer',
      accept: false,
      reasons: ['missing-trailer'],
      oracle: 'none',
      render: 'observe',
      heap: false,
    }),
    gifSample('gif-truncated', 'The file ends inside the logical screen descriptor.', gifStill.subarray(0, 10), {
      ok: false,
      reason: 'truncated',
      canvasWidth: 0,
      canvasHeight: 0,
      frameCount: 0,
      loopCount: null,
      repeatsForever: false,
      animated: false,
      accept: false,
      reasons: ['truncated'],
      oracle: 'none',
      render: 'no',
      heap: false,
    }),
    gifSample('gif-not', 'The header is not GIF87a or GIF89a.', Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]), {
      ok: false,
      reason: 'not-gif',
      canvasWidth: 0,
      canvasHeight: 0,
      frameCount: 0,
      loopCount: null,
      repeatsForever: false,
      animated: false,
      accept: false,
      reasons: ['not-gif'],
      oracle: 'none',
      render: 'no',
      heap: false,
    }),
    gifSample('gif-no-frames', 'A screen and a trailer, with no image descriptor.', bareGif({ width: 8, height: 8, frames: [] }), {
      ok: false,
      reason: 'no-frames',
      canvasWidth: 8,
      canvasHeight: 8,
      frameCount: 0,
      loopCount: null,
      repeatsForever: false,
      animated: false,
      accept: false,
      reasons: ['no-frames'],
      oracle: 'none',
      render: 'no',
      heap: false,
    }),
    gifSample('gif-87a', 'A one-frame GIF87a.', gif87, {
      ...okGif(1, 1, 1, false),
      oracle: 'omggif',
      render: 'assert',
      probes: [redProbe(0, 0, 0)],
      heap: false,
    }),
  ];

  const vp8lOne = chunkData(one, 'VP8L');
  const vp8lFour = chunkData(four, 'VP8L');
  const vp8lEight = chunkData(eight, 'VP8L');
  samples.push(
    webpSample('webp-static-lossless', 'Still lossless WebP.', losslessStill, {
      ...okWebp(64, 64, 1, false),
      oracle: 'libwebp',
      render: 'assert',
      probes: [redProbe(32, 32, 2)],
      heap: false,
    }),
    webpSample('webp-static-lossy', 'Still lossy WebP. The frame count is asserted; this encoder is not a color fixture.', lossyStill, {
      ...okWebp(64, 64, 1, false),
      oracle: 'libwebp',
      render: 'assert',
      heap: false,
    }),
    webpSample('webp-static-lossy-alpha', 'Lossy WebP with an alpha chunk.', lossyAlpha, {
      ...okWebp(8, 8, 1, false),
      hasAlpha: true,
      oracle: 'libwebp',
      render: 'assert',
      probes: [{ x: 4, y: 4, rgba: [255, 0, 0, 128], tolerance: 8 }],
      heap: false,
    }),
    webpSample('webp-static-lossless-alpha', 'Lossless WebP whose pixels are transparent.', losslessAlpha, {
      ...okWebp(8, 8, 1, false),
      hasAlpha: true,
      oracle: 'libwebp',
      render: 'assert',
      probes: [{ x: 4, y: 4, rgba: [0, 0, 0, 0], tolerance: 2 }],
      heap: false,
    }),
    webpSample('webp-odd-size', 'A 3 by 5 lossless WebP.', odd, {
      ...okWebp(3, 5, 1, false),
      oracle: 'libwebp',
      render: 'assert',
      probes: [{ x: 1, y: 2, rgba: [0, 255, 0, 255], tolerance: 2 }],
      heap: false,
    }),
    webpSample('webp-animated-lossless', 'Two lossless animated frames.', animLossless, {
      ...okWebp(64, 64, 2, true),
      loopCount: 0,
      repeatsForever: true,
      oracle: 'libwebp',
      render: 'assert',
      probes: [redProbe(32, 32, 2)],
      distinctFrames: true,
      heap: false,
    }),
    webpSample('webp-animated-lossy', 'Two lossy animated frames. Colors are not exact with this encoder.', animLossy, {
      ...okWebp(32, 32, 2, true),
      loopCount: 0,
      repeatsForever: true,
      oracle: 'libwebp',
      render: 'assert',
      distinctFrames: true,
      heap: false,
    }),
    webpSample('webp-animated-alpha', 'Animated lossless WebP with a translucent first frame.', animAlpha, {
      ...okWebp(8, 8, 2, true),
      hasAlpha: true,
      loopCount: 0,
      repeatsForever: true,
      oracle: 'libwebp',
      render: 'assert',
      probes: [{ x: 4, y: 4, rgba: [255, 0, 0, 128], tolerance: 2 }],
      distinctFrames: true,
      heap: false,
    }),
    webpSample('webp-loop-lie', 'The ANIM loop count is 99. There are two frames.', patchLoop(animLossless, 99), {
      ...okWebp(64, 64, 2, true),
      loopCount: 99,
      repeatsForever: false,
      oracle: 'libwebp',
      render: 'assert',
      probes: [redProbe(32, 32, 2)],
      distinctFrames: true,
      heap: false,
    }),
    webpSample('webp-offset', 'The first ANMF frame sits at (2, 2) and does not cover the canvas.', offsetWebp(vp8lFour, vp8lEight), {
      ...okWebp(8, 8, 2, true),
      loopCount: 0,
      repeatsForever: true,
      hasAlpha: true,
      firstFrame: { x: 2, y: 2, width: 4, height: 4 },
      probes: [
        { x: 0, y: 0, rgba: [0, 0, 0, 0], tolerance: 0 },
        { x: 3, y: 3, rgba: [255, 0, 0, 255], tolerance: 2 },
      ],
      oracle: 'libwebp',
      render: 'observe',
      heap: false,
    }),
    webpSample('webp-exif-lie', 'An EXIF chunk contains the bytes ANMF. It is not a frame.', withExif(animLossless), {
      ...okWebp(64, 64, 2, true),
      loopCount: 0,
      repeatsForever: true,
      naiveAnmfAbove: true,
      oracle: 'libwebp',
      render: 'assert',
      probes: [redProbe(32, 32, 2)],
      distinctFrames: true,
      heap: false,
    }),
    webpSample('webp-flag-clear', 'ANMF frames are present and the VP8X animation bit is clear.', clearAnimation(animLossless), {
      ...okWebp(64, 64, 2, true),
      loopCount: 0,
      repeatsForever: true,
      notes: ['animation-flag-clear'],
      oracle: 'none',
      render: 'observe',
      heap: false,
    }),
    webpSample('webp-flag-empty', 'The animation bit is set and there is no ANMF chunk.', webpFile([
      { tag: 'VP8X', data: vp8xData({ width: 8, height: 8, animation: true }) },
      { tag: 'ANIM', data: animData(0) },
    ]), {
      ok: false,
      reason: 'animation-flag-empty',
      canvasWidth: 8,
      canvasHeight: 8,
      frameCount: 0,
      loopCount: 0,
      repeatsForever: true,
      animated: false,
      accept: false,
      reasons: ['animation-flag-empty'],
      oracle: 'none',
      render: 'no',
      heap: false,
    }),
    webpSample('webp-riff-hides-frame', 'A third ANMF chunk is appended past the RIFF size.', hideFrame(animLossless), {
      ...okWebp(64, 64, 2, true),
      loopCount: 0,
      repeatsForever: true,
      framesPastContainer: 1,
      notes: ['anmf-after-riff'],
      oracle: 'libwebp',
      render: 'observe',
      heap: false,
    }),
    webpSample('webp-1000', '1,000 real lossless animated frames.', anim1000, {
      ...okWebp(1, 1, 1000, true),
      loopCount: 0,
      repeatsForever: true,
      uniform: { x: 0, y: 0, width: 1, height: 1 },
      oracle: 'libwebp',
      render: 'assert',
      probes: [redProbe(0, 0, 2)],
      distinctFrames: true,
      heap: false,
    }),
    webpSample('webp-1001', '1,001 ANMF headers. The VP8 payloads are headers only.', fakeAnimation(1001, 1, 1), {
      ...okWebp(1, 1, 1001, true),
      loopCount: 0,
      repeatsForever: true,
      accept: false,
      reasons: ['too-many-frames'],
      uniform: { x: 0, y: 0, width: 1, height: 1 },
      oracle: 'none',
      render: 'no',
      heap: false,
    }),
    webpSample('webp-pixel-budget', 'Four declared 8000 by 8000 frames. H-28. 256,000,000 pixels.', fakeAnimation(4, 8000, 8000), {
      ...okWebp(8000, 8000, 4, true),
      loopCount: 0,
      repeatsForever: true,
      accept: false,
      reasons: ['pixel-budget'],
      uniform: { x: 0, y: 0, width: 8000, height: 8000 },
      oracle: 'none',
      render: 'no',
      heap: true,
    }),
    webpSample('webp-pixel-under', 'Two declared 8000 by 8000 frames stay under 250,000,000 pixels.', fakeAnimation(2, 8000, 8000), {
      ...okWebp(8000, 8000, 2, true),
      loopCount: 0,
      repeatsForever: true,
      uniform: { x: 0, y: 0, width: 8000, height: 8000 },
      oracle: 'none',
      render: 'no',
      heap: false,
    }),
    webpSample('webp-frame-outside', 'An 8 by 8 frame at (12, 12) extends past an 16 by 16 canvas.', outsideWebp(vp8lEight), {
      ...okWebp(16, 16, 1, true),
      loopCount: 0,
      repeatsForever: true,
      hasAlpha: true,
      accept: false,
      reasons: ['frame-outside'],
      firstFrame: { x: 12, y: 12, width: 8, height: 8 },
      oracle: 'none',
      render: 'no',
      heap: false,
    }),
    webpSample('webp-huge-canvas', 'VP8X says the canvas is 16777216 by 1. The bitstream is 1 by 1.', webpFile([
      { tag: 'VP8X', data: vp8xData({ width: 16777216, height: 1 }) },
      { tag: 'VP8L', data: vp8lOne },
    ]), {
      ok: false,
      reason: 'size-mismatch',
      canvasWidth: 16777216,
      canvasHeight: 1,
      frameCount: 1,
      loopCount: null,
      repeatsForever: false,
      animated: false,
      accept: false,
      reasons: ['bad-canvas', 'size-mismatch'],
      firstFrame: { x: 0, y: 0, width: 1, height: 1 },
      oracle: 'none',
      render: 'no',
      heap: true,
    }),
    webpSample('webp-bitstream-lie', 'ANMF says 1 by 1. The VP8 header inside says 16383 by 16383.', bitstreamLie(), {
      ok: false,
      reason: 'size-mismatch',
      canvasWidth: 8,
      canvasHeight: 8,
      frameCount: 1,
      loopCount: 0,
      repeatsForever: true,
      animated: true,
      accept: false,
      reasons: ['bitstream-oversize', 'pixel-budget', 'size-mismatch'],
      firstFrame: { x: 0, y: 0, width: 1, height: 1 },
      oracle: 'none',
      render: 'no',
      heap: true,
    }),
    webpSample('webp-truncated', 'The file ends inside the first chunk.', animLossless.subarray(0, 16), {
      ok: false,
      reason: 'truncated',
      canvasWidth: 0,
      canvasHeight: 0,
      frameCount: 0,
      loopCount: null,
      repeatsForever: false,
      animated: false,
      accept: false,
      reasons: ['truncated'],
      oracle: 'none',
      render: 'no',
      heap: false,
    }),
    webpSample('webp-not', 'The header is not a WebP RIFF.', Uint8Array.from('not a webp!!'.split('').map((char) => char.charCodeAt(0))), {
      ok: false,
      reason: 'not-webp',
      canvasWidth: 0,
      canvasHeight: 0,
      frameCount: 0,
      loopCount: null,
      repeatsForever: false,
      animated: false,
      accept: false,
      reasons: ['not-webp'],
      oracle: 'none',
      render: 'no',
      heap: false,
    }),
  );

  return { samples, encoderVersion, decoderVersion };
}

function okGif(width: number, height: number, frames: number, animated: boolean): SampleExpect {
  return {
    ok: true,
    reason: null,
    canvasWidth: width,
    canvasHeight: height,
    frameCount: frames,
    loopCount: null,
    repeatsForever: false,
    animated,
    accept: true,
    reasons: [],
    oracle: 'none',
    render: 'no',
    heap: false,
  };
}

function okWebp(width: number, height: number, frames: number, animated: boolean): SampleExpect {
  return okGif(width, height, frames, animated);
}

function gifSample(id: string, note: string, bytes: Uint8Array, expect: SampleExpect): Sample {
  return { id, note, mime: 'image/gif', bytes, expect };
}

function webpSample(id: string, note: string, bytes: Uint8Array, expect: SampleExpect): Sample {
  return { id, note, mime: 'image/webp', bytes, expect };
}

function chunkData(bytes: Uint8Array, tag: string): Uint8Array {
  const riffSize = (bytes[4] ?? 0) | ((bytes[5] ?? 0) << 8) | ((bytes[6] ?? 0) << 16) | ((bytes[7] ?? 0) << 24);
  const parsed = readChunks(bytes, 12, Math.min(bytes.length, 8 + (riffSize >>> 0)));
  const found = parsed.chunks.find((chunk) => chunk.tag === tag);
  if (!found) {
    throw new Error(`missing ${tag}`);
  }
  return Uint8Array.from(found.data);
}

function patchLoop(bytes: Uint8Array, loop: number): Uint8Array {
  const copy = bytes.slice();
  const found = findChunk(copy, 'ANIM');
  copy[found.dataAt + 4] = loop & 0xff;
  copy[found.dataAt + 5] = (loop >>> 8) & 0xff;
  return copy;
}

function clearAnimation(bytes: Uint8Array): Uint8Array {
  const copy = bytes.slice();
  const found = findChunk(copy, 'VP8X');
  copy[found.dataAt] = (copy[found.dataAt] ?? 0) & ~0x02;
  return copy;
}

function withExif(bytes: Uint8Array): Uint8Array {
  const chunks = topChunks(bytes);
  const payload = Uint8Array.from('not-a-frame ANMF fake'.split('').map((char) => char.charCodeAt(0)));
  chunks.push({ tag: 'EXIF', data: payload });
  return webpFile(chunks);
}

function hideFrame(bytes: Uint8Array): Uint8Array {
  const chunks = topChunks(bytes);
  const anmf = chunks.find((chunk) => chunk.tag === 'ANMF');
  if (!anmf) {
    throw new Error('ANMF chunk not found');
  }
  return concat([bytes, chunkBytes('ANMF', anmf.data)]);
}

function topChunks(bytes: Uint8Array): Array<{ tag: string; data: Uint8Array }> {
  const riffSize = (bytes[4] ?? 0) | ((bytes[5] ?? 0) << 8) | ((bytes[6] ?? 0) << 16) | ((bytes[7] ?? 0) << 24);
  const parsed = readChunks(bytes, 12, Math.min(bytes.length, 8 + (riffSize >>> 0)));
  return parsed.chunks.map((chunk) => ({ tag: chunk.tag, data: Uint8Array.from(chunk.data) }));
}

function offsetWebp(small: Uint8Array, full: Uint8Array): Uint8Array {
  return webpFile([
    { tag: 'VP8X', data: vp8xData({ width: 8, height: 8, animation: true, alpha: true }) },
    { tag: 'ANIM', data: animData(0) },
    { tag: 'ANMF', data: anmfData({ x: 2, y: 2, width: 4, height: 4, durationMs: 100, inner: chunkBytes('VP8L', small) }) },
    { tag: 'ANMF', data: anmfData({ x: 0, y: 0, width: 8, height: 8, durationMs: 100, inner: chunkBytes('VP8L', full) }) },
  ]);
}

function findChunk(bytes: Uint8Array, tag: string): { dataAt: number; size: number } {
  let pos = 12;
  const riffSize = (bytes[4] ?? 0) | ((bytes[5] ?? 0) << 8) | ((bytes[6] ?? 0) << 16) | ((bytes[7] ?? 0) << 24);
  const end = Math.min(bytes.length, 8 + (riffSize >>> 0));
  while (pos + 8 <= end) {
    const found = String.fromCharCode(bytes[pos] ?? 0, bytes[pos + 1] ?? 0, bytes[pos + 2] ?? 0, bytes[pos + 3] ?? 0);
    const size = (bytes[pos + 4] ?? 0) | ((bytes[pos + 5] ?? 0) << 8) | ((bytes[pos + 6] ?? 0) << 16) | ((bytes[pos + 7] ?? 0) << 24);
    if (found === tag) {
      return { dataAt: pos + 8, size: size >>> 0 };
    }
    pos += 8 + (size >>> 0) + (size & 1);
  }
  throw new Error(`${tag} chunk not found`);
}

function outsideWebp(vp8l: Uint8Array): Uint8Array {
  return webpFile([
    { tag: 'VP8X', data: vp8xData({ width: 16, height: 16, animation: true, alpha: true }) },
    { tag: 'ANIM', data: animData(0) },
    { tag: 'ANMF', data: anmfData({ x: 12, y: 12, width: 8, height: 8, durationMs: 100, inner: chunkBytes('VP8L', vp8l) }) },
  ]);
}

function fakeAnimation(count: number, width: number, height: number): Uint8Array {
  const inner = chunkBytes('VP8 ', vp8KeyHeader(width, height));
  const frames = Array.from({ length: count }, () => ({
    tag: 'ANMF',
    data: anmfData({ x: 0, y: 0, width, height, durationMs: 20, inner }),
  }));
  return webpFile([
    { tag: 'VP8X', data: vp8xData({ width, height, animation: true }) },
    { tag: 'ANIM', data: animData(0) },
    ...frames,
  ]);
}

function bitstreamLie(): Uint8Array {
  const inner = chunkBytes('VP8 ', vp8KeyHeader(16383, 16383));
  return webpFile([
    { tag: 'VP8X', data: vp8xData({ width: 8, height: 8, animation: true }) },
    { tag: 'ANIM', data: animData(0) },
    { tag: 'ANMF', data: anmfData({ x: 0, y: 0, width: 1, height: 1, durationMs: 20, inner }) },
  ]);
}
