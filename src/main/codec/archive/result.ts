// Reasons a .obk is refused before its entries are used. The wording is the
// message the open path shows. H-09 is the missing document.json case.

export const ARCHIVE_REASONS = [
  'file-too-large',
  'too-many-entries',
  'document-cap',
  'image-cap',
  'total-cap',
  'declared-size-mismatch',
  'encrypted',
  'unsupported-compression',
  'multi-disk',
  'dot-dot',
  'leading-slash',
  'backslash',
  'drive-letter',
  'network-path',
  'stream-suffix',
  'device-name',
  'empty-name',
  'nul-in-name',
  'nested-zip',
  'name-not-allowed',
  'case-duplicate',
  'repeated-name',
  'directory',
  'symlink',
  'header-mismatch',
  'missing-manifest',
  'missing-document',
  'crc-mismatch',
  'not-a-zip',
  'not-a-file',
  'unreadable',
  'zip-error',
] as const;

export type ArchiveReason = (typeof ARCHIVE_REASONS)[number];

const ARCHIVE_MESSAGES: Record<ArchiveReason, string> = {
  'file-too-large': 'This file is over 200 MB, so it was not opened.',
  'too-many-entries': 'This file has over 2,000 entries, so it was not opened.',
  'document-cap': 'document.json is over 25 MB, so it was not opened.',
  'image-cap': 'An image is over 20 MB, so it was not opened.',
  'total-cap': 'This file expands past 250 MB, so it was not opened.',
  'declared-size-mismatch': 'An entry size does not match its header, so it was not opened.',
  encrypted: 'This file has an encrypted entry, so it was not opened.',
  'unsupported-compression': 'This file uses a compression method Obelisk does not read, so it was not opened.',
  'multi-disk': 'This file spans more than one disk, so it was not opened.',
  'dot-dot': 'An entry name contains .., so it was not opened.',
  'leading-slash': 'An entry name starts with a slash, so it was not opened.',
  backslash: 'An entry name contains a backslash, so it was not opened.',
  'drive-letter': 'An entry name has a drive letter, so it was not opened.',
  'network-path': 'An entry name is a network path, so it was not opened.',
  'stream-suffix': 'An entry name has a stream suffix, so it was not opened.',
  'device-name': 'An entry name is a device name, so it was not opened.',
  'empty-name': 'An entry name is empty, so it was not opened.',
  'nul-in-name': 'An entry name contains a NUL, so it was not opened.',
  'nested-zip': 'This file contains a nested archive, so it was not opened.',
  'name-not-allowed': 'An entry name is not part of an Obelisk file, so it was not opened.',
  'case-duplicate': 'Two entry names differ only by case, so it was not opened.',
  'repeated-name': 'An entry name is repeated, so it was not opened.',
  directory: 'This file contains a folder entry, so it was not opened.',
  symlink: 'This file contains a link entry, so it was not opened.',
  'header-mismatch': 'The central directory and a local header disagree, so it was not opened.',
  'missing-manifest': 'This file has no manifest.json, so it was not opened.',
  'missing-document': 'This file has no document.json, so it was not opened.',
  'crc-mismatch': 'An entry checksum does not match its bytes, so it was not opened.',
  'not-a-zip': 'This file is not an Obelisk archive, so it was not opened.',
  'not-a-file': 'This path is not a file, so it was not opened.',
  unreadable: 'This file could not be read, so it was not opened.',
  'zip-error': 'This archive could not be read, so it was not opened.',
};

export function archiveMessage(reason: ArchiveReason): string {
  return ARCHIVE_MESSAGES[reason];
}

export function isArchiveReason(value: string): value is ArchiveReason {
  return Object.prototype.hasOwnProperty.call(ARCHIVE_MESSAGES, value);
}

export interface ArchiveCounts {
  opened: boolean;
  entriesRead: number;
  payloadsRead: number;
  bytesRead: number;
  cappedEntryBytesRead: number | null;
}

export interface ArchiveResult extends ArchiveCounts {
  ok: boolean;
  reason: ArchiveReason | 'ok';
  path: string;
  message: string;
}

export function refused(reason: ArchiveReason, entryPath: string, counts: Partial<ArchiveCounts> = {}): ArchiveResult {
  return {
    ok: false,
    reason,
    path: entryPath,
    message: archiveMessage(reason),
    opened: false,
    entriesRead: 0,
    payloadsRead: 0,
    bytesRead: 0,
    cappedEntryBytesRead: null,
    ...counts,
  };
}
