import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { writeAtomic } from '../file/writeAtomic.js';
import { RECENTS_FILE, RECENTS_MAX } from './constants.js';
import {
  defaultRecents,
  parseRecentsText,
  type RecentEntry,
  type RecentRecord,
} from './validate.js';

function recentsPath(userDataDir: string): string {
  return path.join(userDataDir, RECENTS_FILE);
}

function newId(used: Set<string>): string {
  let id = randomBytes(16).toString('hex');
  while (used.has(id)) {
    id = randomBytes(16).toString('hex');
  }
  return id;
}

export class RecentsStore {
  private record: RecentRecord = defaultRecents();
  private loaded = false;
  private persistPromise: Promise<void> | null = null;

  constructor(private readonly userDataDir: string) {}

  private ensureLoaded(): void {
    if (this.loaded) {
      return;
    }
    const filePath = recentsPath(this.userDataDir);
    try {
      if (fs.existsSync(filePath)) {
        this.record = parseRecentsText(fs.readFileSync(filePath, 'utf8'));
      } else {
        this.record = defaultRecents();
      }
    } catch {
      this.record = defaultRecents();
    }
    this.loaded = true;
  }

  listForRenderer(): { id: string; name: string; location: string }[] {
    this.ensureLoaded();
    return this.record.entries.map((entry) => ({
      id: entry.id,
      name: entry.name,
      location: path.dirname(entry.path),
    }));
  }

  pathForId(id: string): string | null {
    this.ensureLoaded();
    const found = this.record.entries.find((entry) => entry.id === id);
    return found?.path ?? null;
  }

  touch(filePath: string, name: string, openedMs = Date.now()): void {
    this.ensureLoaded();
    const resolved = path.resolve(filePath);
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    const without = this.record.entries.filter(
      (entry) => (process.platform === 'win32' ? entry.path.toLowerCase() : path.resolve(entry.path)) !== key,
    );
    const used = new Set(without.map((entry) => entry.id));
    const next: RecentEntry = {
      id: newId(used),
      name,
      path: resolved,
      openedMs,
    };
    this.record = {
      version: 1,
      entries: [next, ...without].slice(0, RECENTS_MAX),
    };
    this.persistPromise = this.persist();
  }

  private async persist(): Promise<void> {
    const bytes = Buffer.from(`${JSON.stringify(this.record)}\n`, 'utf8');
    await writeAtomic(recentsPath(this.userDataDir), bytes, {
      kind: 'record',
      privateAppData: [this.userDataDir],
    });
  }

  /** Waits for the latest recents write, if any. */
  async flush(): Promise<void> {
    if (this.persistPromise !== null) {
      await this.persistPromise;
    }
  }
}

const cache = new Map<string, RecentsStore>();

export function recentsStore(userDataDir: string): RecentsStore {
  const existing = cache.get(userDataDir);
  if (existing !== undefined) {
    return existing;
  }
  const store = new RecentsStore(userDataDir);
  cache.set(userDataDir, store);
  return store;
}

export function clearRecentsStoreCache(): void {
  cache.clear();
}