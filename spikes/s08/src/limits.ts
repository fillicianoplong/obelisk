/** Byte caps from architecture section 6.6 and OD-21. MB here is 1024 * 1024. */
export const MIB = 1024 * 1024;

export const FILE_CAP = 200 * MIB;
export const DOCUMENT_CAP = 25 * MIB;
export const IMAGE_CAP = 20 * MIB;
export const TOTAL_CAP = 250 * MIB;
export const ENTRY_CAP = 2000;

/** Uncompressed size written into a bomb's local and central headers. */
export const FORGED_DECLARED_SIZE = 64;

export const FIXED_MTIME = new Date(Date.UTC(2020, 0, 1, 0, 0, 0));
