import { createHash } from 'node:crypto';

export const SIGNATURE_NAME = 'Spike signature';
export const SIGNATURE_SAVED_AT = '2026-10-27T00:00:00.000Z';

// 1x1 PNG. The ciphertext is checked so this text is not stored in the clear.
export const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const PLAIN = JSON.stringify({
  name: SIGNATURE_NAME,
  savedAt: SIGNATURE_SAVED_AT,
  pngBase64: PNG_BASE64,
});

export function signaturePlaintext(): string {
  return PLAIN;
}

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function leaksIn(cipher: Buffer): string[] {
  const leaks: string[] = [];
  if (cipher.includes(Buffer.from(PLAIN, 'utf8'))) leaks.push('plaintext');
  if (cipher.includes(Buffer.from(SIGNATURE_NAME, 'utf8'))) leaks.push('name');
  if (cipher.includes(Buffer.from(PNG_BASE64, 'utf8'))) leaks.push('png');
  return leaks;
}
