// Format 1 caps from architecture section 6.6. A megabyte is 1024 * 1024
// bytes, the same size spike S-08 used. The harness checks these against
// src/shared/schema/limits.ts so the two cannot drift.

export const MIB = 1024 * 1024;

export const FILE_MAX_BYTES = 200 * MIB;
export const ENTRY_MAX_COUNT = 2000;
export const DOCUMENT_JSON_MAX_BYTES = 25 * MIB;
export const IMAGE_MAX_BYTES = 20 * MIB;
export const ARCHIVE_MAX_UNCOMPRESSED_BYTES = 250 * MIB;

export const IMAGE_DIMENSION_MAX = 8000;
export const ANIMATION_FRAME_MAX = 1000;
export const ANIMATION_PIXEL_MAX = 250_000_000;

export const BLOCK_MAX = 20_000;
export const TEXT_MAX_CHARS = 100_000;
export const TABLE_ROW_MAX = 200;
export const TABLE_COLUMN_MAX = 26;

/** Uncompressed size written into a bomb's local and central headers. */
export const FORGED_DECLARED_SIZE = 64;

/** Anything larger than this on disk, other than the sparse oversize file, is a mistake. */
export const FIXTURE_DISK_MAX_BYTES = 8 * MIB;
