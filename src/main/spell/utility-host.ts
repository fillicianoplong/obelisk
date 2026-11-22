import path from 'node:path';
import { utilityProcess, type UtilityProcess } from 'electron';
import { bundledDictionary } from './paths.js';
import { addUserWord, readUserWords } from './user-words.js';

const SERVICE_NAME = 'obk-spell';

interface SpellReply {
  id: number;
  ok: boolean;
  misspelled?: boolean | string[];
  suggestions?: string[];
  message?: string;
}

function childEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      env[key] = value;
    }
  }
  env.NODE_PATH = path.resolve(__dirname, '../../..', 'node_modules');
  return env;
}

function isReply(value: unknown): value is SpellReply {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as { id?: unknown; ok?: unknown };
  return typeof record.id === 'number' && typeof record.ok === 'boolean';
}

export class SpellHost {
  private child: UtilityProcess | null = null;
  private ready: Promise<void> | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, (reply: SpellReply) => void>();

  constructor(private readonly userDataDir: () => string, private readonly appPath: () => string) {}

  check(words: readonly string[]): Promise<string[]> {
    return this.request({ kind: 'check', words: [...words] }).then((reply) => {
      return Array.isArray(reply.misspelled) ? reply.misspelled.filter((item) => typeof item === 'string') : [];
    });
  }

  suggest(word: string): Promise<{ misspelled: boolean; suggestions: string[] }> {
    return this.request({ kind: 'suggest', word }).then((reply) => ({
      misspelled: reply.misspelled === true,
      suggestions: Array.isArray(reply.suggestions)
        ? reply.suggestions.filter((item) => typeof item === 'string').slice(0, 5)
        : [],
    }));
  }

  add(word: string): Promise<void> {
    const words = addUserWord(this.userDataDir(), word);
    if (!words.includes(word)) {
      return Promise.resolve();
    }
    return this.request({ kind: 'add', word }).then(() => undefined);
  }

  private request(body: Record<string, unknown>): Promise<SpellReply> {
    return this.ensure().then(() => new Promise((resolve, reject) => {
      const id = this.nextId;
      this.nextId += 1;
      this.pending.set(id, resolve);
      try {
        this.child?.postMessage({ id, ...body });
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    }));
  }

  private ensure(): Promise<void> {
    if (this.ready !== null && this.child !== null) {
      return this.ready;
    }
    const files = bundledDictionary(this.appPath());
    if (files === null) {
      return Promise.reject(new Error('The spelling dictionary is not installed.'));
    }
    const words = readUserWords(this.userDataDir());
    this.ready = new Promise((resolve, reject) => {
      let child: UtilityProcess;
      try {
        child = utilityProcess.fork(path.join(__dirname, 'utility-child.js'), [], {
          serviceName: SERVICE_NAME,
          stdio: 'pipe',
          env: childEnv(),
        });
      } catch (error) {
        this.ready = null;
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      this.child = child;
      const initId = this.nextId;
      this.nextId += 1;
      child.once('spawn', () => {
        child.postMessage({ id: initId, kind: 'init', affPath: files.aff, dicPath: files.dic, words });
      });
      child.on('message', (message: unknown) => {
        if (!isReply(message)) {
          return;
        }
        if (message.id === initId) {
          if (message.ok) {
            resolve();
          } else {
            this.ready = null;
            reject(new Error(message.message ?? 'The spelling dictionary did not load.'));
          }
          return;
        }
        const waiter = this.pending.get(message.id);
        if (waiter === undefined) {
          return;
        }
        this.pending.delete(message.id);
        waiter(message);
      });
      child.once('exit', () => {
        if (this.child === child) {
          this.child = null;
          this.ready = null;
        }
      });
    });
    return this.ready;
  }
}
