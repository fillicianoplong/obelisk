import path from 'node:path';
import { encodeObk } from '../codec/encode/index.js';
import type { DecodeResult } from '../codec/decode.js';
import { FORMAT_NAME, FORMAT_VERSION } from '../../shared/schema/index.js';
import type { Document } from '../../shared/schema/index.js';
import { writeAtomic } from './writeAtomic.js';

// The installed app saves and reopens through the same encoder, atomic write,
// and utility-process reader as File > Save and File > Open.

const OPEN_TEXT_MAX = 200;

export interface PackageIoRequest {
  openPath: string;
  savePath: string;
  openText: string;
  saveText: string;
}

export type PackageIoEnv =
  | { ok: true; request: PackageIoRequest }
  | { ok: false; message: string };

function blockId(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function paragraphFields(n: number) {
  return {
    id: blockId(n),
    align: 'left' as const,
    lineSpacing: 'single' as const,
    spaceBefore: 0 as const,
    spaceAfter: 0 as const,
    indents: { left: 0, first: 0, hanging: 0 },
  };
}

export function packageIoDocument(text: string): Document {
  return {
    view: 'pageless',
    page: {
      paper: 'letter',
      orientation: 'portrait',
      margins: { top: 1, right: 1, bottom: 1, left: 1 },
    },
    header: { ...paragraphFields(1), content: [] },
    footer: { ...paragraphFields(2), content: [] },
    blocks: [{
      type: 'paragraph',
      ...paragraphFields(3),
      content: text.length === 0 ? [] : [{ type: 'text', text }],
    }],
  };
}

export function paragraphText(document: Document): string {
  const block = document.blocks[0];
  if (!block || block.type !== 'paragraph') {
    return '';
  }
  let text = '';
  for (const part of block.content) {
    if (part.type === 'text' || part.type === 'link') {
      text += part.text;
    }
  }
  return text;
}

function requiredText(value: string | undefined, name: string): string | null {
  if (typeof value !== 'string' || value.length < 1 || value.length > OPEN_TEXT_MAX) {
    return null;
  }
  if (value.includes('\0') || value.includes('\n') || value.includes('\r')) {
    return null;
  }
  if (name.length === 0) {
    return null;
  }
  return value;
}

function requiredPath(value: string | undefined): string | null {
  if (typeof value !== 'string' || !path.isAbsolute(value)) {
    return null;
  }
  return value;
}

export function readPackageIoRequest(env: NodeJS.ProcessEnv): PackageIoEnv {
  const openPath = requiredPath(env.OBELISK_PACKAGE_IO_OPEN);
  const savePath = requiredPath(env.OBELISK_PACKAGE_IO_SAVE);
  const openText = requiredText(env.OBELISK_PACKAGE_IO_OPEN_TEXT, 'open');
  const saveText = requiredText(env.OBELISK_PACKAGE_IO_SAVE_TEXT, 'save');
  if (!openPath || !savePath || openText === null || saveText === null) {
    return { ok: false, message: 'The package check was not given an absolute path and a text.' };
  }
  if (openPath === savePath) {
    return { ok: false, message: 'The package check must open one file and save another.' };
  }
  return { ok: true, request: { openPath, savePath, openText, saveText } };
}

export async function runPackagedIoCheck(
  request: PackageIoRequest,
  readObk: (filePath: string) => Promise<DecodeResult>,
): Promise<void> {
  const opened = await readObk(request.openPath);
  if (!opened.ok) {
    throw new Error(opened.message.length > 0 ? opened.message : 'The file could not be opened.');
  }
  if (paragraphText(opened.document) !== request.openText) {
    throw new Error('The opened file did not contain the expected text.');
  }

  const encoded = await encodeObk(packageIoDocument(request.saveText), {
    format: FORMAT_NAME,
    formatVersion: FORMAT_VERSION,
    writer: 'obelisk',
    images: [],
  });
  if (!encoded.ok) {
    throw new Error('This document is not valid, so it was not saved.');
  }
  const written = await writeAtomic(request.savePath, encoded.bytes);
  if (written.status !== 'ok') {
    throw new Error(written.message);
  }

  const saved = await readObk(request.savePath);
  if (!saved.ok) {
    throw new Error(saved.message.length > 0 ? saved.message : 'The saved file could not be opened.');
  }
  if (paragraphText(saved.document) !== request.saveText) {
    throw new Error('The saved file did not contain the expected text.');
  }
}
