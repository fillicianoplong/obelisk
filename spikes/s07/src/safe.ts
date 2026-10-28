import { safeStorage } from 'electron';
import { leaksIn, signaturePlaintext } from './payload';

interface DecryptShape {
  result?: unknown;
  shouldReEncrypt?: unknown;
}

interface AsyncSafe {
  isEncryptionAvailable: () => boolean;
  isAsyncEncryptionAvailable: () => Promise<boolean>;
  encryptString: (plain: string) => Buffer;
  decryptString: (encrypted: Buffer) => string;
  encryptStringAsync: (plain: string) => Promise<Buffer>;
  decryptStringAsync: (encrypted: Buffer) => Promise<DecryptShape>;
}

export interface CryptoResult {
  encryptionAvailable: boolean | null;
  asyncEncryptionAvailable: boolean | null;
  deprecationWarnings: string[];
  syncRoundTrip: boolean | null;
  syncError: string | null;
  sessionEncryption: boolean;
  plaintextMatch: boolean | null;
  shouldReEncrypt: boolean | null;
  secondShouldReEncrypt: boolean | null;
  encryptError: string | null;
  decryptError: string | null;
  temporarilyUnavailable: boolean;
  unencryptedDecryptError: string | null;
  leaks: string[];
  cipher: Buffer | null;
  reencrypted: Buffer | null;
}

const warnings: string[] = [];
let hooked = false;

function hookWarnings(): void {
  if (hooked) return;
  hooked = true;
  process.on('warning', (warning) => {
    warnings.push(warning.message);
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function temporarily(text: string | null): boolean {
  return text !== null && text.toLowerCase().includes('temporarily unavailable');
}

function requireApi(): AsyncSafe {
  const api = safeStorage as Partial<AsyncSafe>;
  if (typeof api.isEncryptionAvailable !== 'function'
    || typeof api.isAsyncEncryptionAvailable !== 'function'
    || typeof api.encryptString !== 'function'
    || typeof api.decryptString !== 'function'
    || typeof api.encryptStringAsync !== 'function'
    || typeof api.decryptStringAsync !== 'function') {
    throw new Error('The async safeStorage methods are missing.');
  }
  return api as AsyncSafe;
}

function blank(): CryptoResult {
  return {
    encryptionAvailable: null,
    asyncEncryptionAvailable: null,
    deprecationWarnings: [],
    syncRoundTrip: null,
    syncError: null,
    sessionEncryption: false,
    plaintextMatch: null,
    shouldReEncrypt: null,
    secondShouldReEncrypt: null,
    encryptError: null,
    decryptError: null,
    temporarilyUnavailable: false,
    unencryptedDecryptError: null,
    leaks: [],
    cipher: null,
    reencrypted: null,
  };
}

async function flushWarnings(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

async function readAvailability(api: AsyncSafe, result: CryptoResult): Promise<void> {
  hookWarnings();
  try {
    result.encryptionAvailable = api.isEncryptionAvailable();
  } catch (error) {
    result.syncError = messageOf(error);
  }
  try {
    const encrypted = api.encryptString(signaturePlaintext());
    result.syncRoundTrip = api.decryptString(encrypted) === signaturePlaintext();
  } catch (error) {
    result.syncError = messageOf(error);
    result.syncRoundTrip = false;
  }
  await flushWarnings();
  result.deprecationWarnings = warnings.slice();
  try {
    result.asyncEncryptionAvailable = await api.isAsyncEncryptionAvailable();
  } catch (error) {
    result.encryptError = messageOf(error);
  }
}

function readDecrypt(value: DecryptShape): { result: string; shouldReEncrypt: boolean | null } {
  const result = typeof value.result === 'string' ? value.result : '';
  const shouldReEncrypt = typeof value.shouldReEncrypt === 'boolean' ? value.shouldReEncrypt : null;
  return { result, shouldReEncrypt };
}

async function decryptBuffer(api: AsyncSafe, cipher: Buffer): Promise<{
  match: boolean;
  shouldReEncrypt: boolean | null;
  error: string | null;
}> {
  try {
    const decoded = readDecrypt(await api.decryptStringAsync(cipher));
    return {
      match: decoded.result === signaturePlaintext(),
      shouldReEncrypt: decoded.shouldReEncrypt,
      error: null,
    };
  } catch (error) {
    return { match: false, shouldReEncrypt: null, error: messageOf(error) };
  }
}

export async function encryptSample(): Promise<CryptoResult> {
  const api = requireApi();
  const result = blank();
  await readAvailability(api, result);
  try {
    const cipher = await api.encryptStringAsync(signaturePlaintext());
    if (!Buffer.isBuffer(cipher)) {
      result.encryptError = 'encryptStringAsync did not return a buffer.';
      return result;
    }
    result.cipher = cipher;
    result.leaks = leaksIn(cipher);
    const decoded = await decryptBuffer(api, cipher);
    result.plaintextMatch = decoded.match;
    result.shouldReEncrypt = decoded.shouldReEncrypt;
    result.decryptError = decoded.error;
    result.sessionEncryption = decoded.match && result.leaks.length === 0;
    result.temporarilyUnavailable = temporarily(decoded.error);
    if (decoded.shouldReEncrypt === true && decoded.match) {
      const again = await decryptBuffer(api, cipher);
      result.secondShouldReEncrypt = again.shouldReEncrypt;
      const next = await api.encryptStringAsync(signaturePlaintext());
      if (Buffer.isBuffer(next)) result.reencrypted = next;
    }
  } catch (error) {
    result.encryptError = messageOf(error);
    result.temporarilyUnavailable = temporarily(result.encryptError);
  }
  try {
    await api.decryptStringAsync(Buffer.from('not-a-ciphertext', 'utf8'));
  } catch (error) {
    result.unencryptedDecryptError = messageOf(error);
  }
  return result;
}

export async function decryptSample(cipher: Buffer): Promise<CryptoResult> {
  const api = requireApi();
  const result = blank();
  await readAvailability(api, result);
  result.cipher = cipher;
  result.leaks = leaksIn(cipher);
  const decoded = await decryptBuffer(api, cipher);
  result.plaintextMatch = decoded.match;
  result.shouldReEncrypt = decoded.shouldReEncrypt;
  result.decryptError = decoded.error;
  result.temporarilyUnavailable = temporarily(decoded.error);
  result.sessionEncryption = false;
  if (decoded.shouldReEncrypt === true && decoded.match) {
    const again = await decryptBuffer(api, cipher);
    result.secondShouldReEncrypt = again.shouldReEncrypt;
    try {
      const next = await api.encryptStringAsync(signaturePlaintext());
      if (Buffer.isBuffer(next)) result.reencrypted = next;
    } catch (error) {
      result.encryptError = messageOf(error);
    }
  }
  return result;
}

export async function probeSample(cipher: Buffer | null): Promise<CryptoResult> {
  const api = requireApi();
  const result = blank();
  await readAvailability(api, result);
  try {
    const cipherText = await api.encryptStringAsync(signaturePlaintext());
    if (!Buffer.isBuffer(cipherText)) {
      result.encryptError = 'encryptStringAsync did not return a buffer.';
    } else {
      const decoded = await decryptBuffer(api, cipherText);
      result.sessionEncryption = decoded.match;
      if (!decoded.match && decoded.error) result.encryptError = decoded.error;
    }
  } catch (error) {
    result.encryptError = messageOf(error);
    result.temporarilyUnavailable = temporarily(result.encryptError);
  }
  if (cipher) {
    const decoded = await decryptBuffer(api, cipher);
    result.plaintextMatch = decoded.match;
    result.shouldReEncrypt = decoded.shouldReEncrypt;
    result.decryptError = decoded.error;
    if (temporarily(decoded.error)) result.temporarilyUnavailable = true;
  }
  return result;
}
