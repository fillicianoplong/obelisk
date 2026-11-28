import path from 'node:path';
import { LAUNCH_FILE_MAX } from '../file/launchPaths.js';
import { emptySession, type SessionRecord } from './defaults.js';

function isObkPath(value: string): boolean {
  if (!path.isAbsolute(value)) {
    return false;
  }
  return path.win32.extname(value).toLowerCase() === '.obk';
}

function normalizePathList(paths: unknown, seen: Set<string>): string[] {
  if (!Array.isArray(paths)) {
    return [];
  }
  const list: string[] = [];
  for (const item of paths) {
    if (typeof item !== 'string' || !isObkPath(item)) {
      continue;
    }
    const key = process.platform === 'win32' ? item.toLowerCase() : item;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    list.push(item);
    if (list.length >= LAUNCH_FILE_MAX) {
      break;
    }
  }
  return list;
}

export function normalizeSession(source: Record<string, unknown> | null): SessionRecord {
  const base = emptySession();
  if (source === null) {
    return base;
  }
  const version = typeof source.version === 'number' && Number.isInteger(source.version) && source.version >= 1
    ? source.version
    : base.version;
  const seen = new Set<string>();
  const paths = normalizePathList(source.paths, seen);
  let activePath: string | null = null;
  if (typeof source.activePath === 'string' && isObkPath(source.activePath)) {
    const key = process.platform === 'win32' ? source.activePath.toLowerCase() : source.activePath;
    const inList = paths.some(
      (entry) => (process.platform === 'win32' ? entry.toLowerCase() : entry) === key,
    );
    if (inList) {
      activePath = source.activePath;
    }
  }
  return { version, paths, activePath };
}

export function parseSessionText(text: string): SessionRecord | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return normalizeSession(parsed as Record<string, unknown>);
  } catch {
    return null;
  }
}