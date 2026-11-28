export interface SavedSignatureRecord {
  name: string;
  savedAt: string;
  pngBase64: string;
}

export function serializeSignatureRecord(record: SavedSignatureRecord): string {
  return JSON.stringify(record);
}

export function parseSignatureRecord(text: string): SavedSignatureRecord | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.name !== 'string'
      || typeof record.savedAt !== 'string'
      || typeof record.pngBase64 !== 'string'
      || record.pngBase64.length < 1
    ) {
      return null;
    }
    return {
      name: record.name,
      savedAt: record.savedAt,
      pngBase64: record.pngBase64,
    };
  } catch {
    return null;
  }
}