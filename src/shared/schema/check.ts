import { checkDocumentRules, checkImages, checkManifestRules } from './rules.js';
import type { CheckResult } from './result.js';
import { documentSchema } from './schema-data.js';
import type { Document, Manifest } from './types.js';
import { validateWith, type JsonSchema } from './validate.js';

function definition(name: string): JsonSchema {
  if (!documentSchema.$defs?.[name]) {
    throw new Error(`Missing schema definition ${name}`);
  }
  return { $defs: documentSchema.$defs, $ref: `#/$defs/${name}` };
}

export function checkDocument(value: unknown): CheckResult<Document> {
  const issue = validateWith(documentSchema, value);
  if (issue) {
    return issue;
  }
  const rules = checkDocumentRules(value as Document);
  if (rules) {
    return rules;
  }
  return { ok: true, value: value as Document };
}

export function checkManifest(value: unknown): CheckResult<Manifest> {
  const issue = validateWith(definition('manifest'), value);
  if (issue) {
    return issue;
  }
  const rules = checkManifestRules(value as Manifest);
  if (rules) {
    return rules;
  }
  return { ok: true, value: value as Manifest };
}

export function checkPair(
  document: unknown,
  manifest: unknown,
): CheckResult<{ document: Document; manifest: Manifest }> {
  const checkedDocument = checkDocument(document);
  if (!checkedDocument.ok) {
    return checkedDocument;
  }
  const checkedManifest = checkManifest(manifest);
  if (!checkedManifest.ok) {
    return checkedManifest;
  }
  const images = checkImages(checkedDocument.value, checkedManifest.value);
  if (images) {
    return images;
  }
  return {
    ok: true,
    value: { document: checkedDocument.value, manifest: checkedManifest.value },
  };
}
