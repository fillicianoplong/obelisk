import fs from 'node:fs';
import path from 'node:path';
import { SIGNATURE_INDEX_VERSION } from './constants.js';

export interface SignatureIndex {
  version: number;
  order: string[];
}

export function signatureIndexPath(userDataDir: string): string {
  return path.join(userDataDir, 'signatures', 'index.json');
}

function token(id: unknown): string | null {
  if (typeof id !== 'string' || id.length < 1 || id.length > 64) {
    return null;
  }
  if (!/^[0-9a-f]+$/.test(id)) {
    return null;
  }
  return id;
}

export function parseSignatureIndexText(text: string): SignatureIndex {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { version: SIGNATURE_INDEX_VERSION, order: [] };
    }
    const record = parsed as Record<string, unknown>;
    const version = typeof record.version === 'number' && Number.isInteger(record.version)
      ? record.version
      : SIGNATURE_INDEX_VERSION;
    const orderRaw = Array.isArray(record.order) ? record.order : [];
    const order: string[] = [];
    const seen = new Set<string>();
    for (const entry of orderRaw) {
      const id = token(entry);
      if (id === null || seen.has(id)) {
        continue;
      }
      seen.add(id);
      order.push(id);
    }
    return { version, order };
  } catch {
    return { version: SIGNATURE_INDEX_VERSION, order: [] };
  }
}

export function readSignatureIndex(userDataDir: string): SignatureIndex {
  const filePath = signatureIndexPath(userDataDir);
  try {
    if (!fs.existsSync(filePath)) {
      return { version: SIGNATURE_INDEX_VERSION, order: [] };
    }
    return parseSignatureIndexText(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return { version: SIGNATURE_INDEX_VERSION, order: [] };
  }
}