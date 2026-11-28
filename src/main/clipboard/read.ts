import { inspectFileImageBytes } from '../images/inspect.js';

const TEXT_MAX = 1_000_000;
const HTML_MAX = 2_000_000;
const START_FRAGMENT = '<!--StartFragment-->';
const END_FRAGMENT = '<!--EndFragment-->';

export interface ClipboardItemLike {
  types: readonly string[];
  getType(type: string): Promise<unknown>;
}

/** Windows clipboard HTML wraps the fragment. The sanitizer wants the fragment only. */
export function clipboardHtmlFragment(value: string): string {
  const start = value.indexOf(START_FRAGMENT);
  const end = value.indexOf(END_FRAGMENT);
  if (start !== -1 && end > start) {
    return value.slice(start + START_FRAGMENT.length, end);
  }
  return value;
}

function capped(value: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0) {
    return '';
  }
  if (value.length <= max) {
    return value;
  }
  return value.slice(0, max);
}

async function asText(value: unknown): Promise<string> {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return value.text();
  }
  return '';
}

export function clipboardPayload(
  text: string,
  html: string,
  image: string | null = null,
): { text: string; html: string; image: string | null } {
  return {
    text: capped(text, TEXT_MAX),
    html: capped(clipboardHtmlFragment(html), HTML_MAX),
    image,
  };
}

async function imageBytesFromItem(item: ClipboardItemLike): Promise<Uint8Array | null> {
  for (const type of ['image/png', 'image/jpeg', 'image/gif', 'image/webp']) {
    if (!item.types.includes(type)) {
      continue;
    }
    const value = await item.getType(type);
    if (typeof Blob !== 'undefined' && value instanceof Blob) {
      return new Uint8Array(await value.arrayBuffer());
    }
    if (typeof value === 'string' && value.length > 0) {
      const bytes = Buffer.from(value, 'latin1');
      return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
  }
  return null;
}

function inspectedClipboardImage(bytes: Uint8Array): string | null {
  const inspected = inspectFileImageBytes(bytes);
  if (inspected.status !== 'ok') {
    return null;
  }
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

export function clipboardImageFromNativePng(png: Uint8Array): string | null {
  if (png.byteLength === 0) {
    return null;
  }
  return inspectedClipboardImage(png);
}

/** Text comes from readText. HTML comes from a text/html clipboard item. */
export async function readClipboardItems(
  items: readonly ClipboardItemLike[],
  plainText = '',
  nativeImage: Uint8Array | null = null,
): Promise<{ text: string; html: string; image: string | null }> {
  let text = typeof plainText === 'string' ? plainText : '';
  let html = '';
  let image: string | null = null;
  for (const item of items) {
    if (html.length === 0 && item.types.includes('text/html')) {
      html = await asText(await item.getType('text/html'));
    }
    if (text.length === 0 && item.types.includes('text/plain')) {
      text = await asText(await item.getType('text/plain'));
    }
    if (image === null) {
      const bytes = await imageBytesFromItem(item);
      if (bytes !== null) {
        image = inspectedClipboardImage(bytes);
      }
    }
  }
  if (image === null && nativeImage !== null) {
    image = clipboardImageFromNativePng(nativeImage);
  }
  return clipboardPayload(text, html, image);
}
