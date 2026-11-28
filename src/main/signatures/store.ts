import fs from 'node:fs';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { inspectFileImageBytes } from './inspect.js';
import { writeAtomic } from '../file/writeAtomic.js';
import type {
  SigDeleteResult,
  SigGetResult,
  SigListResult,
  SigSaveRequest,
  SigSaveResult,
  SigGetRequest,
  SigDeleteRequest,
} from '../../shared/ipc/types.js';
import {
  ENCRYPTION_UNAVAILABLE_MESSAGE,
  SAVED_SIGNATURE_MAX,
  SAVED_SIGNATURE_NAME_MAX,
  SAVED_SIGNATURE_NAME_MIN,
  SIGNATURES_DIR,
} from './constants.js';
import { decryptSignatureCipher, encryptSignaturePlaintext, signatureCrypto } from './crypto.js';
import { parseSignatureRecord, serializeSignatureRecord, type SavedSignatureRecord } from './record.js';
import { readSignatureIndex, signatureIndexPath, type SignatureIndex } from './index-file.js';

function signaturesDir(userDataDir: string): string {
  return path.join(userDataDir, SIGNATURES_DIR);
}

function signatureFilePath(userDataDir: string, id: string): string {
  return path.join(signaturesDir(userDataDir), `${id}.sig`);
}

function newSignatureId(used: Set<string>): string {
  let id = randomBytes(16).toString('hex');
  while (used.has(id)) {
    id = randomBytes(16).toString('hex');
  }
  return id;
}

function pngBytesFromBase64(text: string): Uint8Array | null {
  try {
    const buffer = Buffer.from(text, 'base64');
    if (buffer.length < 1) {
      return null;
    }
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  } catch {
    return null;
  }
}

function nameAllowed(name: string): boolean {
  if (name.length < SAVED_SIGNATURE_NAME_MIN || name.length > SAVED_SIGNATURE_NAME_MAX) {
    return false;
  }
  for (const char of name) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127) {
      return false;
    }
    if (char === '/' || char === '\\') {
      return false;
    }
  }
  return true;
}

function sameName(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0;
}

async function readDecryptedRecord(userDataDir: string, id: string): Promise<SavedSignatureRecord | null> {
  const filePath = signatureFilePath(userDataDir, id);
  try {
    const cipher = fs.readFileSync(filePath);
    const plain = await decryptSignatureCipher(cipher);
    if (plain === null) {
      return null;
    }
    return parseSignatureRecord(plain);
  } catch {
    return null;
  }
}

export class SignatureStore {
  private index: SignatureIndex | null = null;

  constructor(private readonly userDataDir: string) {}

  private ensureIndex(): SignatureIndex {
    if (this.index === null) {
      this.index = readSignatureIndex(this.userDataDir);
    }
    return this.index;
  }

  private async persistIndex(order: string[]): Promise<void> {
    const index: SignatureIndex = { version: 1, order: [...order] };
    this.index = index;
    const bytes = new TextEncoder().encode(`${JSON.stringify(index)}\n`);
    const result = await writeAtomic(signatureIndexPath(this.userDataDir), bytes, {
      kind: 'record',
      privateAppData: [this.userDataDir],
    });
    if (result.status !== 'ok') {
      throw new Error('The signature index could not be saved.');
    }
  }

  async list(): Promise<SigListResult> {
    if (!signatureCrypto().isEncryptionAvailable()) {
      return { status: 'unavailable', message: ENCRYPTION_UNAVAILABLE_MESSAGE };
    }
    const order = this.ensureIndex().order;
    const signatures: { id: string; name: string }[] = [];
    for (const id of order) {
      const record = await readDecryptedRecord(this.userDataDir, id);
      if (record === null) {
        continue;
      }
      signatures.push({ id, name: record.name });
    }
    return { status: 'ok', signatures };
  }

  async get(request: SigGetRequest): Promise<SigGetResult> {
    if (!signatureCrypto().isEncryptionAvailable()) {
      return { status: 'unavailable', message: ENCRYPTION_UNAVAILABLE_MESSAGE };
    }
    const order = this.ensureIndex().order;
    if (!order.includes(request.id)) {
      return { status: 'notFound' };
    }
    const record = await readDecryptedRecord(this.userDataDir, request.id);
    if (record === null) {
      return { status: 'unavailable', message: ENCRYPTION_UNAVAILABLE_MESSAGE };
    }
    return { status: 'ok', png: record.pngBase64 };
  }

  async save(request: SigSaveRequest): Promise<SigSaveResult> {
    if (!signatureCrypto().isEncryptionAvailable()) {
      return { status: 'unavailable', message: ENCRYPTION_UNAVAILABLE_MESSAGE };
    }
    if (!nameAllowed(request.name)) {
      return {
        status: 'refused',
        reason: 'bad-name',
        message: `Saved signature names must be ${SAVED_SIGNATURE_NAME_MIN} to ${SAVED_SIGNATURE_NAME_MAX} characters.`,
      };
    }
    const pngBytes = pngBytesFromBase64(request.png);
    if (pngBytes === null || inspectFileImageBytes(pngBytes).status !== 'ok') {
      return {
        status: 'refused',
        reason: 'bad-image',
        message: 'That image is not a saved signature.',
      };
    }
    const order = [...this.ensureIndex().order];
    const existingNames: string[] = [];
    for (const id of order) {
      const record = await readDecryptedRecord(this.userDataDir, id);
      if (record !== null) {
        existingNames.push(record.name);
      }
    }
    if (existingNames.some((name) => sameName(name, request.name))) {
      return {
        status: 'refused',
        reason: 'duplicate-name',
        message: 'A saved signature with that name already exists.',
      };
    }
    if (order.length >= SAVED_SIGNATURE_MAX) {
      return { status: 'limitReached' };
    }
    const record: SavedSignatureRecord = {
      name: request.name,
      savedAt: new Date().toISOString(),
      pngBase64: request.png,
    };
    const plain = serializeSignatureRecord(record);
    const cipher = await encryptSignaturePlaintext(plain);
    if (cipher === null) {
      return { status: 'unavailable', message: ENCRYPTION_UNAVAILABLE_MESSAGE };
    }
    const used = new Set(order);
    const id = newSignatureId(used);
    const dir = signaturesDir(this.userDataDir);
    mkdirSync(dir, { recursive: true });
    const filePath = signatureFilePath(this.userDataDir, id);
    const result = await writeAtomic(filePath, cipher, {
      kind: 'record',
      privateAppData: [this.userDataDir],
    });
    if (result.status !== 'ok') {
      return {
        status: 'error',
        code: 'EACCES',
        message: 'The signature could not be saved.',
        retryable: false,
      };
    }
    order.push(id);
    try {
      await this.persistIndex(order);
    } catch {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // best effort
      }
      return {
        status: 'error',
        code: 'EACCES',
        message: 'The signature could not be saved.',
        retryable: false,
      };
    }
    return { status: 'ok', id };
  }

  async delete(request: SigDeleteRequest): Promise<SigDeleteResult> {
    if (!signatureCrypto().isEncryptionAvailable()) {
      return { status: 'notFound' };
    }
    const order = [...this.ensureIndex().order];
    const index = order.indexOf(request.id);
    if (index < 0) {
      return { status: 'notFound' };
    }
    order.splice(index, 1);
    const filePath = signatureFilePath(this.userDataDir, request.id);
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      return { status: 'notFound' };
    }
    await this.persistIndex(order);
    return { status: 'ok' };
  }
}

const stores = new Map<string, SignatureStore>();

export function signatureStore(userDataDir: string): SignatureStore {
  let store = stores.get(userDataDir);
  if (store === undefined) {
    store = new SignatureStore(userDataDir);
    stores.set(userDataDir, store);
  }
  return store;
}

/** Test-only: drop cached stores so rewritten files are read again. */
export function clearSignatureStoreCache(): void {
  stores.clear();
}