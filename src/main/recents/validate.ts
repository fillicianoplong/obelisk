import { RECENTS_MAX } from './constants.js';

export interface RecentRecord {
  version: 1;
  entries: RecentEntry[];
}

export interface RecentEntry {
  id: string;
  name: string;
  path: string;
  openedMs: number;
}

const ID_PATTERN = /^[a-f0-9]{32}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseEntry(value: unknown): RecentEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  const { id, name, path, openedMs } = value;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    return null;
  }
  if (typeof name !== 'string' || name.length < 1 || name.length > 255) {
    return null;
  }
  if (typeof path !== 'string' || path.length < 1) {
    return null;
  }
  if (typeof openedMs !== 'number' || !Number.isFinite(openedMs) || openedMs < 0) {
    return null;
  }
  return { id, name, path, openedMs };
}

export function defaultRecents(): RecentRecord {
  return { version: 1, entries: [] };
}

export function parseRecentsText(text: string): RecentRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return defaultRecents();
  }
  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
    return defaultRecents();
  }
  const entries: RecentEntry[] = [];
  for (const item of parsed.entries) {
    if (entries.length >= RECENTS_MAX) {
      break;
    }
    const entry = parseEntry(item);
    if (entry !== null) {
      entries.push(entry);
    }
  }
  return { version: 1, entries };
}