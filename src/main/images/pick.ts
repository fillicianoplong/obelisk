import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { IpcImageBytes, StoredImageType } from '../../shared/images/asset.js';
import type { ImagePickResult } from '../../shared/ipc/types.js';
import { inspectFileImageBytes } from './inspect.js';

const IMAGE_FILTERS = [
  { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
];

export interface ImagePickDeps {
  pickPath(): Promise<{ canceled: boolean; filePaths: string[] }>;
}

function forcedImagePickPath(): string | null {
  const value = process.env.OBELISK_IMAGE_PICK_PATH?.trim() ?? '';
  if (value.length === 0 || !path.isAbsolute(value)) {
    return null;
  }
  return value;
}

async function readPickedImageFile(filePath: string): Promise<ImagePickResult> {

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch {
    return { status: 'refused', reason: 'unreadable', message: 'This image could not be read, so it was not inserted.' };
  }
  const data = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const inspected = inspectFileImageBytes(data);
  if (inspected.status === 'refused') {
    return { status: 'refused', reason: inspected.reason, message: inspected.message };
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const asset: IpcImageBytes & {
    type: StoredImageType;
    pixelWidth: number;
    pixelHeight: number;
    frames: number;
  } = {
    sha256,
    data: toBase64(data),
    type: inspected.inspected.type,
    pixelWidth: inspected.inspected.width,
    pixelHeight: inspected.inspected.height,
    frames: inspected.inspected.frames,
  };
  return { status: 'ok', image: asset };
}

export async function pickImageFile(deps: ImagePickDeps): Promise<ImagePickResult> {
  const forced = forcedImagePickPath();
  if (forced !== null) {
    return readPickedImageFile(forced);
  }
  let picked;
  try {
    picked = await deps.pickPath();
  } catch {
    return { status: 'error', code: 'EACCES', message: 'The Open dialog could not be shown.', retryable: false };
  }
  if (picked.canceled || picked.filePaths.length === 0) {
    return { status: 'cancelled' };
  }
  const filePath = picked.filePaths[0];
  if (typeof filePath !== 'string') {
    return { status: 'cancelled' };
  }
  return readPickedImageFile(filePath);
}

export function imageOpenDialogOptions(): {
  title: string;
  properties: ['openFile'];
  filters: typeof IMAGE_FILTERS;
} {
  return {
    title: 'Insert image',
    properties: ['openFile'],
    filters: IMAGE_FILTERS,
  };
}