import {
  checkDocument,
  checkManifest,
  type Document,
  type Manifest,
  type SchemaReason,
} from '../../../shared/schema/index.js';

// Format 1 has one schema. These checks are that schema: unknown fields,
// types, ranges, repeated block ids, the block and table caps, and a column
// row that contains another column row or a page break. Image bytes are a
// later check.

export type JsonEntry = 'manifest.json' | 'document.json';

export interface ValidateFailure {
  ok: false;
  entry: JsonEntry;
  reason: SchemaReason;
  path: string;
  message: string;
}

export type ValidateResult =
  | { ok: true; document: Document; manifest: Manifest }
  | ValidateFailure;

export function validateOpened(documentValue: unknown, manifestValue: unknown): ValidateResult {
  const manifest = checkManifest(manifestValue);
  if (!manifest.ok) {
    return {
      ok: false,
      entry: 'manifest.json',
      reason: manifest.reason,
      path: manifest.path,
      message: manifest.message,
    };
  }
  const document = checkDocument(documentValue);
  if (!document.ok) {
    return {
      ok: false,
      entry: 'document.json',
      reason: document.reason,
      path: document.path,
      message: document.message,
    };
  }
  return { ok: true, document: document.value, manifest: manifest.value };
}
