import fs from 'node:fs';
import { Module as NodeModule } from 'node:module';
import path from 'node:path';

export interface WebpDecoded {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface WebpDecodedFrame extends WebpDecoded {
  duration: number;
}

export interface WebpApi {
  encoderVersion(): Promise<string>;
  decoderVersion(): Promise<string>;
  encode(
    data: Uint8Array,
    width: number,
    height: number,
    hasAlpha: boolean,
    config: { lossless: number; quality: number },
  ): Promise<Uint8Array | null>;
  encodeRGBA(data: Uint8Array, width: number, height: number, quality?: number): Promise<Uint8Array | null>;
  encodeAnimation(
    width: number,
    height: number,
    hasAlpha: boolean,
    frames: Array<{ data: Uint8Array; duration: number; config?: { lossless: number; quality: number } }>,
  ): Promise<Uint8Array | null>;
  decodeRGBA(data: Uint8Array): Promise<WebpDecoded | null>;
  decodeAnimation(data: Uint8Array, hasAlpha: boolean): Promise<WebpDecodedFrame[] | null>;
}

interface Compilable {
  filename: string;
  paths: string[];
  exports: unknown;
  _compile(source: string, filename: string): void;
}

const factoryKey = '__obeliskSpikeS06WebpFactory';

function loadCompiled(filename: string, source: string): unknown {
  const ctor = NodeModule as unknown as {
    new (id: string): Compilable;
    _nodeModulePaths(from: string): string[];
  };
  const compiled = new ctor(filename);
  compiled.filename = filename;
  compiled.paths = ctor._nodeModulePaths(path.dirname(filename));
  compiled._compile(source, filename);
  return compiled.exports;
}

let apiPromise: Promise<WebpApi> | null = null;

export function loadWebp(spikeRoot: string): Promise<WebpApi> {
  if (!apiPromise) {
    apiPromise = Promise.resolve(loadWebpSync(spikeRoot));
  }
  return apiPromise;
}

function loadWebpSync(spikeRoot: string): WebpApi {
  const directory = path.join(spikeRoot, 'node_modules', 'wasm-webp', 'dist', 'cjs');
  const wasmFile = path.join(directory, 'webp-wasm.js');
  const indexFile = path.join(directory, 'index.js');
  const factory = loadCompiled(wasmFile, fs.readFileSync(wasmFile, 'utf8'));
  const holder = globalThis as Record<string, unknown>;
  holder[factoryKey] = factory;
  const source = fs.readFileSync(indexFile, 'utf8').replace('require("./webp-wasm")', `globalThis.${factoryKey}`);
  const loaded = loadCompiled(indexFile, source) as WebpApi;
  delete holder[factoryKey];
  return loaded;
}

export async function encodeBytes(
  api: WebpApi,
  rgba: Uint8Array,
  width: number,
  height: number,
  hasAlpha: boolean,
  lossless: boolean,
): Promise<Uint8Array> {
  const encoded = await api.encode(rgba, width, height, hasAlpha, { lossless: lossless ? 1 : 0, quality: 100 });
  if (!encoded) {
    throw new Error('webp encode returned nothing');
  }
  return Uint8Array.from(encoded);
}

export async function encodeAnimationBytes(
  api: WebpApi,
  width: number,
  height: number,
  hasAlpha: boolean,
  frames: Array<{ data: Uint8Array; duration: number; lossless: boolean }>,
): Promise<Uint8Array> {
  const encoded = await api.encodeAnimation(
    width,
    height,
    hasAlpha,
    frames.map((frame) => ({
      data: frame.data,
      duration: frame.duration,
      config: { lossless: frame.lossless ? 1 : 0, quality: 100 },
    })),
  );
  if (!encoded) {
    throw new Error('webp animation encode returned nothing');
  }
  return Uint8Array.from(encoded);
}
