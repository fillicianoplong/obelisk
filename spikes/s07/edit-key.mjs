// Rewrites os_crypt.encrypted_key in a Chromium Local State file.
// invalid-header: the value does not start with DPAPI.
// dpapi-fail: the value starts with DPAPI and the rest is not a DPAPI blob.
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
const mode = process.argv[3];
if (!file || (mode !== 'invalid-header' && mode !== 'dpapi-fail')) {
  console.error('Usage: node edit-key.mjs <Local State> <invalid-header|dpapi-fail>');
  process.exit(1);
}

let text = readFileSync(file, 'utf8');
if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
const data = JSON.parse(text);
const bucket = data.os_crypt && typeof data.os_crypt === 'object' ? data.os_crypt : null;
if (!bucket || typeof bucket.encrypted_key !== 'string' || bucket.encrypted_key.length < 8) {
  console.error('Local State has no os_crypt.encrypted_key string.');
  process.exit(1);
}

const header = mode === 'invalid-header' ? 'XXXX' : 'DPAPI';
const raw = Buffer.concat([Buffer.from(header, 'utf8'), randomBytes(48)]);
bucket.encrypted_key = raw.toString('base64');
writeFileSync(file, JSON.stringify(data));
console.log(`edited ${mode} bytes=${raw.length}`);
