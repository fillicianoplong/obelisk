import type { Document, Manifest } from '../../shared/schema/index.js';
import { readArchivePayload, type ArchiveResult } from './archive/index.js';
import { checkImageEntries } from './images/index.js';
import { jsonFileMessage, parseJson, type JsonReason } from './json/index.js';
import { migrateOpened } from './migrate/index.js';
import { validateOpened, type JsonEntry } from './validate/index.js';

// Archive checks run first. JSON is parsed only from bytes that passed them.
// The schema runs only after both JSON values parse. Image headers run after
// the schema, on the same bytes, and do not decode pixels. Nothing here writes the file.

export type DecodeStage = 'archive' | 'json' | 'schema' | 'image' | 'document';

interface DecodeCounts {
  opened: boolean;
  entriesRead: number;
  payloadsRead: number;
  bytesRead: number;
  cappedEntryBytesRead: number | null;
}

export interface DecodeFailure extends DecodeCounts {
  ok: false;
  stage: 'archive' | 'json' | 'schema' | 'image';
  reason: string;
  path: string;
  message: string;
  entry: string;
}

export interface DecodeSuccess extends DecodeCounts {
  ok: true;
  stage: 'document';
  reason: 'ok';
  path: '';
  message: '';
  entry: '';
  document: Document;
  manifest: Manifest;
}

export type DecodeResult = DecodeSuccess | DecodeFailure;

function countsOf(result: ArchiveResult): DecodeCounts {
  return {
    opened: result.opened,
    entriesRead: result.entriesRead,
    payloadsRead: result.payloadsRead,
    bytesRead: result.bytesRead,
    cappedEntryBytesRead: result.cappedEntryBytesRead,
  };
}

function fromArchive(result: ArchiveResult): DecodeFailure {
  return {
    ok: false,
    stage: 'archive',
    reason: result.reason,
    path: result.path,
    message: result.message,
    entry: result.path,
    ...countsOf(result),
  };
}

function jsonFailure(entry: JsonEntry, reason: JsonReason, path: string, archive: ArchiveResult): DecodeFailure {
  return {
    ok: false,
    stage: 'json',
    reason,
    path,
    message: jsonFileMessage(entry, reason),
    entry,
    ...countsOf(archive),
  };
}

export async function decodeObk(filePath: string): Promise<DecodeResult> {
  const opened = await readArchivePayload(filePath);
  if (!opened.ok) {
    return fromArchive(opened.result);
  }

  const manifestParsed = parseJson(opened.manifest);
  if (!manifestParsed.ok) {
    return jsonFailure('manifest.json', manifestParsed.reason, manifestParsed.path, opened.result);
  }
  const documentParsed = parseJson(opened.document);
  if (!documentParsed.ok) {
    return jsonFailure('document.json', documentParsed.reason, documentParsed.path, opened.result);
  }

  const migrated = migrateOpened(documentParsed.value, manifestParsed.value);
  if (!migrated.ok) {
    return {
      ok: false,
      stage: 'schema',
      reason: migrated.reason,
      path: migrated.path,
      message: migrated.message,
      entry: 'manifest.json',
      ...countsOf(opened.result),
    };
  }

  const checked = validateOpened(migrated.document, migrated.manifest);
  if (!checked.ok) {
    return {
      ok: false,
      stage: 'schema',
      reason: checked.reason,
      path: checked.path,
      message: checked.message,
      entry: checked.entry,
      ...countsOf(opened.result),
    };
  }

  const images = checkImageEntries(checked.manifest, opened.images);
  if (!images.ok) {
    return {
      ok: false,
      stage: 'image',
      reason: images.reason,
      path: images.path,
      message: images.message,
      entry: images.path,
      ...countsOf(opened.result),
    };
  }

  return {
    ok: true,
    stage: 'document',
    reason: 'ok',
    path: '',
    message: '',
    entry: '',
    document: checked.document,
    manifest: checked.manifest,
    ...countsOf(opened.result),
  };
}
