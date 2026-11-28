import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const storeUrl = pathToFileURL(path.resolve('dist/main/signatures/index.js')).href;

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function mockCrypto(enabled, plainByCipher = new Map(), cipherByPlain = new Map()) {
  return {
    isEncryptionAvailable() {
      return enabled;
    },
    async encryptStringAsync(plain) {
      if (!enabled) {
        throw new Error('Encryption is unavailable.');
      }
      const key = createHash('sha256').update(plain, 'utf8').digest('hex');
      const cipher = Buffer.from(key, 'utf8');
      cipherByPlain.set(plain, cipher);
      plainByCipher.set(key, plain);
      return cipher;
    },
    async decryptStringAsync(cipher) {
      const plain = plainByCipher.get(cipher.toString('utf8'));
      if (plain === undefined) {
        throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptStringAsync.');
      }
      return { result: plain, shouldReEncrypt: false };
    },
  };
}

test('saved signatures stay unavailable when encryption is unavailable', async () => {
  const { signatureStore, setSignatureCryptoForTests, clearSignatureStoreCache } = await import(storeUrl);
  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-sig-'));
  setSignatureCryptoForTests(mockCrypto(false));
  clearSignatureStoreCache();
  const store = signatureStore(directory);
  const list = await store.list();
  assert.equal(list.status, 'unavailable');
  const saved = await store.save({ name: 'Ada', png: PNG_BASE64 });
  assert.equal(saved.status, 'unavailable');
  setSignatureCryptoForTests(null);
});

test('a saved signature round-trips encrypted on disk', async () => {
  const { signatureStore, setSignatureCryptoForTests, clearSignatureStoreCache } = await import(storeUrl);
  const directory = await mkdtemp(path.join(tmpdir(), 'obelisk-sig-ok-'));
  const plainByCipher = new Map();
  const cipherByPlain = new Map();
  setSignatureCryptoForTests(mockCrypto(true, plainByCipher, cipherByPlain));
  clearSignatureStoreCache();
  const store = signatureStore(directory);
  const saved = await store.save({ name: 'Work', png: PNG_BASE64 });
  assert.equal(saved.status, 'ok');
  const file = path.join(directory, 'signatures', `${saved.id}.sig`);
  const bytes = await readFile(file);
  assert.equal(bytes.includes(Buffer.from(PNG_BASE64, 'utf8')), false);
  const listed = await store.list();
  assert.equal(listed.status, 'ok');
  assert.deepEqual(listed.signatures, [{ id: saved.id, name: 'Work' }]);
  const got = await store.get({ id: saved.id });
  assert.equal(got.status, 'ok');
  assert.equal(got.png, PNG_BASE64);
  setSignatureCryptoForTests(null);
});