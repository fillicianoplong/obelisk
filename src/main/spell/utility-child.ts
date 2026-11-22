import fs from 'node:fs';
import { createSpellEngine, type SpellEngine } from './engine.js';

interface ParentMessage {
  data: unknown;
}

interface UtilityParentPort {
  on(event: 'message', listener: (event: ParentMessage) => void): void;
  postMessage(message: unknown): void;
}

interface InitRequest {
  id: number;
  kind: 'init';
  affPath: string;
  dicPath: string;
  words: string[];
}

interface CheckRequest {
  id: number;
  kind: 'check';
  words: string[];
}

interface SuggestRequest {
  id: number;
  kind: 'suggest';
  word: string;
}

interface AddRequest {
  id: number;
  kind: 'add';
  word: string;
}

type SpellRequest = InitRequest | CheckRequest | SuggestRequest | AddRequest;

function parentPort(): UtilityParentPort | null {
  const candidate = (process as NodeJS.Process & { parentPort?: UtilityParentPort }).parentPort;
  if (candidate === undefined || typeof candidate.on !== 'function' || typeof candidate.postMessage !== 'function') {
    return null;
  }
  return candidate;
}

function isRequest(value: unknown): value is SpellRequest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as { id?: unknown; kind?: unknown };
  return typeof record.id === 'number' && typeof record.kind === 'string';
}

export function startSpellChild(): void {
  const port = parentPort();
  if (port === null) {
    return;
  }
  let engine: SpellEngine | null = null;
  port.on('message', (event) => {
    const message = event.data;
    if (!isRequest(message)) {
      return;
    }
    if (message.kind === 'init') {
      try {
        engine = createSpellEngine(
          fs.readFileSync(message.affPath),
          fs.readFileSync(message.dicPath),
          message.words,
        );
        port.postMessage({ id: message.id, ok: true });
      } catch (error) {
        port.postMessage({
          id: message.id,
          ok: false,
          message: error instanceof Error ? error.message : 'The dictionary did not load.',
        });
      }
      return;
    }
    if (engine === null) {
      port.postMessage({ id: message.id, ok: false, message: 'The dictionary is not loaded.' });
      return;
    }
    if (message.kind === 'check') {
      const misspelled = message.words.filter((word) => engine?.misspelled(word) === true);
      port.postMessage({ id: message.id, ok: true, misspelled });
      return;
    }
    if (message.kind === 'suggest') {
      const misspelled = engine.misspelled(message.word);
      port.postMessage({
        id: message.id,
        ok: true,
        misspelled,
        suggestions: misspelled ? engine.suggestions(message.word) : [],
      });
      return;
    }
    engine.add(message.word);
    port.postMessage({ id: message.id, ok: true });
  });
}

startSpellChild();
