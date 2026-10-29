interface PreloadProbe {
  sandboxed: boolean;
  type: string;
  contextIsolated: boolean;
  electron: string;
  chrome: string;
  node: string;
}

interface ProbePoint {
  x: number;
  y: number;
}

interface RenderJob {
  id: string;
  mime: string;
  b64: string;
  canvasWidth: number;
  canvasHeight: number;
  frame0: { x: number; y: number; width: number; height: number };
  points: ProbePoint[];
}

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

interface SpikeApi {
  preloadProbe(): PreloadProbe;
  next(): Promise<RenderJob | null>;
  result(payload: unknown): Promise<unknown>;
  done(payload: unknown): Promise<unknown>;
}

void main();

async function main(): Promise<void> {
  const spike = (window as Window & { spike?: SpikeApi }).spike;
  if (!spike) {
    return;
  }
  const pageProbe = {
    hasProcess: 'process' in globalThis,
    hasRequire: 'require' in globalThis,
    hasModule: 'module' in globalThis,
    hasBuffer: 'Buffer' in globalThis,
    hasElectron: 'electron' in globalThis,
    userAgent: navigator.userAgent,
  };
  const preloadProbe = spike.preloadProbe();
  for (;;) {
    const job = await spike.next();
    if (!job) {
      break;
    }
    console.log(`decode ${job.id}`);
    try {
      const result = await decodeJob(job);
      await spike.result(result);
    } catch (error) {
      await spike.result({
        id: job.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  await spike.done({ pageProbe, preloadProbe });
}

async function decodeJob(job: RenderJob): Promise<unknown> {
  const bytes = decodeBase64(job.b64);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: job.mime });
  const imageElement = await drawElement(blob, job.points);
  const bitmap = await drawBitmap(blob, job.points);
  const decoded = await drawDecoder(bytes, job);
  return {
    id: job.id,
    error: null,
    imageElement,
    bitmap,
    decoder: decoded.decoder,
    frame0: decoded.frame0,
    frame1: decoded.frame1,
    placed: decoded.placed,
  };
}

async function drawElement(blob: Blob, points: ProbePoint[]): Promise<Surface> {
  try {
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return await surfaceFromSource(image, image.naturalWidth, image.naturalHeight, points);
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (error) {
    return emptySurface(error);
  }
}

async function drawBitmap(blob: Blob, points: ProbePoint[]): Promise<Surface> {
  try {
    const bitmap = await createImageBitmap(blob);
    try {
      return await surfaceFromSource(bitmap, bitmap.width, bitmap.height, points);
    } finally {
      bitmap.close();
    }
  } catch (error) {
    return emptySurface(error);
  }
}

interface DecoderDraw {
  decoder: { frameCount: number; repetitionCount: number | null; repeatsForever: boolean; error: string | null } | null;
  frame0: Surface | null;
  frame1: Surface | null;
  placed: Surface | null;
}

async function drawDecoder(bytes: Uint8Array, job: RenderJob): Promise<DecoderDraw> {
  const ctor = (globalThis as { ImageDecoder?: new (init: { data: Uint8Array; type: string }) => ImageDecoderLike }).ImageDecoder;
  if (!ctor) {
    return { decoder: { frameCount: 0, repetitionCount: null, repeatsForever: false, error: 'ImageDecoder missing' }, frame0: null, frame1: null, placed: null };
  }
  const decoder = new ctor({ data: bytes, type: job.mime });
  try {
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    if (!track) {
      return { decoder: { frameCount: 0, repetitionCount: null, repeatsForever: false, error: 'no track' }, frame0: null, frame1: null, placed: null };
    }
    const repeatsForever = track.repetitionCount === Infinity;
    const repetitionCount = repeatsForever ? null : track.repetitionCount;
    const frame0 = await drawFrame(decoder, 0, job.points);
    const frame1 = track.frameCount > 1 ? await drawFrame(decoder, 1, [{ x: Math.floor(frame0.width / 2), y: Math.floor(frame0.height / 2) }]) : null;
    const placed = await placeFrame(decoder, job);
    return {
      decoder: { frameCount: track.frameCount, repetitionCount, repeatsForever, error: null },
      frame0,
      frame1,
      placed,
    };
  } catch (error) {
    return {
      decoder: { frameCount: 0, repetitionCount: null, repeatsForever: false, error: error instanceof Error ? error.message : String(error) },
      frame0: null,
      frame1: null,
      placed: null,
    };
  } finally {
    decoder.close();
  }
}

interface ImageDecoderLike {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number; repetitionCount: number } | null };
  decode(options: { frameIndex: number }): Promise<{ image: CanvasImageSource & { close?: () => void; displayWidth?: number; codedWidth?: number; displayHeight?: number; codedHeight?: number } }>;
  close(): void;
}

async function drawFrame(decoder: ImageDecoderLike, index: number, points: ProbePoint[]): Promise<Surface> {
  const decoded = await decoder.decode({ frameIndex: index });
  const image = decoded.image;
  try {
    const bitmap = await createImageBitmap(image);
    try {
      return await surfaceFromSource(bitmap, bitmap.width, bitmap.height, points);
    } finally {
      bitmap.close();
    }
  } finally {
    image.close?.();
  }
}

async function placeFrame(decoder: ImageDecoderLike, job: RenderJob): Promise<Surface> {
  const decoded = await decoder.decode({ frameIndex: 0 });
  const image = decoded.image;
  try {
    const bitmap = await createImageBitmap(image);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = job.canvasWidth;
      canvas.height = job.canvasHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) {
        return emptySurface('no 2d context');
      }
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, job.frame0.x, job.frame0.y, job.frame0.width, job.frame0.height);
      return await surfaceFromCanvas(canvas, job.points);
    } finally {
      bitmap.close();
    }
  } finally {
    image.close?.();
  }
}

async function surfaceFromSource(source: CanvasImageSource, width: number, height: number, points: ProbePoint[]): Promise<Surface> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return emptySurface('no 2d context');
  }
  context.drawImage(source, 0, 0);
  return surfaceFromCanvas(canvas, points);
}

async function surfaceFromCanvas(canvas: HTMLCanvasElement, points: ProbePoint[]): Promise<Surface> {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    return emptySurface('no 2d context');
  }
  const sampled = points.map((point) => ({
    x: point.x,
    y: point.y,
    rgba: sample(context, canvas.width, canvas.height, point.x, point.y),
  }));
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((value) => resolve(value), 'image/png');
  });
  if (!blob) {
    return { width: canvas.width, height: canvas.height, points: sampled, pngB64: null, error: 'png failed' };
  }
  return {
    width: canvas.width,
    height: canvas.height,
    points: sampled,
    pngB64: bytesToBase64(new Uint8Array(await blob.arrayBuffer())),
    error: null,
  };
}

function sample(context: CanvasRenderingContext2D, width: number, height: number, x: number, y: number): Rgba | null {
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return null;
  }
  const pixel = context.getImageData(x, y, 1, 1).data;
  return { r: pixel[0] ?? 0, g: pixel[1] ?? 0, b: pixel[2] ?? 0, a: pixel[3] ?? 0 };
}

function emptySurface(error: unknown): Surface {
  return {
    width: 0,
    height: 0,
    points: [],
    pngB64: null,
    error: error instanceof Error ? error.message : String(error),
  };
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x2000;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return btoa(binary);
}
