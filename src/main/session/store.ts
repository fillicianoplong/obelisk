import fs from 'node:fs';
import path from 'node:path';
import { writeAtomic } from '../file/writeAtomic.js';
import { SESSION_FILE, SESSION_PERSIST_DEBOUNCE_MS } from './constants.js';
import { emptySession, type SessionRecord } from './defaults.js';
import { parseSessionText } from './validate.js';

function sessionPath(userDataDir: string): string {
  return path.join(userDataDir, SESSION_FILE);
}

export class SessionStore {
  private record: SessionRecord = emptySession();
  private loaded = false;
  private damagedOnDisk = false;
  private persistPromise: Promise<void> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingWrite: SessionRecord | null = null;

  constructor(private readonly userDataDir: string) {}

  private ensureLoaded(): void {
    if (this.loaded) {
      return;
    }
    const filePath = sessionPath(this.userDataDir);
    this.record = emptySession();
    this.damagedOnDisk = false;
    try {
      if (fs.existsSync(filePath)) {
        const parsed = parseSessionText(fs.readFileSync(filePath, 'utf8'));
        if (parsed === null) {
          this.damagedOnDisk = true;
        } else {
          this.record = parsed;
        }
      }
    } catch {
      this.damagedOnDisk = true;
    }
    this.loaded = true;
  }

  read(): SessionRecord {
    this.ensureLoaded();
    return { ...this.record, paths: [...this.record.paths] };
  }

  damaged(): boolean {
    this.ensureLoaded();
    return this.damagedOnDisk;
  }

  scheduleUpdate(next: Pick<SessionRecord, 'paths' | 'activePath'>): void {
    this.ensureLoaded();
    this.record = {
      version: this.record.version,
      paths: [...next.paths],
      activePath: next.activePath,
    };
  }

  queuePersist(immediate = false): Promise<void> {
    this.ensureLoaded();
    this.pendingWrite = { ...this.record, paths: [...this.record.paths] };
    if (this.damagedOnDisk) {
      return Promise.resolve();
    }
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (immediate) {
      return this.flushNow();
    }
    return new Promise((resolve) => {
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        void this.flushNow().then(resolve, resolve);
      }, SESSION_PERSIST_DEBOUNCE_MS);
    });
  }

  async flush(): Promise<void> {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.pendingWrite === null) {
      return;
    }
    await this.flushNow();
  }

  disposeTimers(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  async clear(): Promise<void> {
    this.ensureLoaded();
    this.record = emptySession();
    this.pendingWrite = null;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    const filePath = sessionPath(this.userDataDir);
    if (!fs.existsSync(filePath)) {
      return;
    }
    await fs.promises.unlink(filePath).catch(() => undefined);
  }

  private async flushNow(): Promise<void> {
    const snapshot = this.pendingWrite ?? { ...this.record, paths: [...this.record.paths] };
    this.pendingWrite = null;
    if (snapshot.paths.length === 0 && snapshot.activePath === null) {
      const filePath = sessionPath(this.userDataDir);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath).catch(() => undefined);
      }
      return;
    }
    const bytes = new TextEncoder().encode(`${JSON.stringify(snapshot)}\n`);
    this.persistPromise = writeAtomic(sessionPath(this.userDataDir), bytes, {
      kind: 'record',
      privateAppData: [this.userDataDir],
    }).then((result) => {
      if (result.status !== 'ok') {
        const message = 'message' in result && typeof result.message === 'string'
          ? result.message
          : 'The session could not be saved.';
        throw new Error(message);
      }
    });
    await this.persistPromise;
  }
}

const stores = new Map<string, SessionStore>();

export function sessionStore(userDataDir: string): SessionStore {
  let store = stores.get(userDataDir);
  if (store === undefined) {
    store = new SessionStore(userDataDir);
    stores.set(userDataDir, store);
  }
  return store;
}

export function sessionFilePath(userDataDir: string): string {
  return sessionPath(userDataDir);
}

export function clearSessionStoreCache(): void {
  for (const store of stores.values()) {
    store.disposeTimers();
  }
  stores.clear();
}