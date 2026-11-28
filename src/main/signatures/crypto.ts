import { safeStorage } from 'electron';

export interface DecryptPayload {
  result?: unknown;
  shouldReEncrypt?: boolean;
}

export interface SignatureCrypto {
  isEncryptionAvailable(): boolean;
  encryptStringAsync(plain: string): Promise<Buffer>;
  decryptStringAsync(cipher: Buffer): Promise<DecryptPayload>;
}

function liveCrypto(): SignatureCrypto {
  return {
    isEncryptionAvailable(): boolean {
      return safeStorage.isEncryptionAvailable();
    },
    async encryptStringAsync(plain: string): Promise<Buffer> {
      return safeStorage.encryptStringAsync(plain);
    },
    async decryptStringAsync(cipher: Buffer): Promise<DecryptPayload> {
      return safeStorage.decryptStringAsync(cipher) as Promise<DecryptPayload>;
    },
  };
}

let active: SignatureCrypto = liveCrypto();

export function signatureCrypto(): SignatureCrypto {
  return active;
}

/** Test-only: substitute safeStorage with a mock. */
export function setSignatureCryptoForTests(next: SignatureCrypto | null): void {
  active = next ?? liveCrypto();
}

export async function encryptSignaturePlaintext(plain: string): Promise<Buffer | null> {
  const crypto = signatureCrypto();
  if (!crypto.isEncryptionAvailable()) {
    return null;
  }
  try {
    const cipher = await crypto.encryptStringAsync(plain);
    return Buffer.isBuffer(cipher) ? cipher : null;
  } catch {
    return null;
  }
}

export async function decryptSignatureCipher(cipher: Buffer): Promise<string | null> {
  const crypto = signatureCrypto();
  try {
    const decoded = await crypto.decryptStringAsync(cipher);
    if (typeof decoded.result === 'string') {
      if (decoded.shouldReEncrypt === true) {
        // Spike S-07 did not observe shouldReEncrypt true; re-encrypt when asked later.
      }
      return decoded.result;
    }
    return null;
  } catch {
    return null;
  }
}