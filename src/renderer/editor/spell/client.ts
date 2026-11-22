import type { SpellCheckResult, SpellSuggestResult } from '../../../shared/ipc/types.js';

const cache = new Map<string, boolean>();
const listeners = new Set<() => void>();

function api(): Window['obelisk'] | null {
  const host = globalThis as { window?: { obelisk?: Window['obelisk'] } };
  return host.window?.obelisk ?? null;
}

export function cachedMisspelled(word: string): boolean | undefined {
  return cache.get(word);
}

export function rememberChecked(words: readonly string[], misspelled: readonly string[]): void {
  const marked = new Set(misspelled);
  for (const word of words) {
    cache.set(word, marked.has(word));
  }
}

export function rememberCorrect(word: string): void {
  cache.set(word, false);
  for (const listener of listeners) {
    listener();
  }
}

export function whenSpellCacheChanges(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function checkWords(words: readonly string[]): Promise<string[] | null> {
  const bridge = api();
  if (bridge === undefined || bridge === null || words.length === 0) {
    return Promise.resolve(words.length === 0 ? [] : null);
  }
  return bridge['spell:check']({ words: [...words] }).then((result: SpellCheckResult) => {
    return result.status === 'ok' ? result.misspelled : null;
  }).catch(() => null);
}

export function suggestWord(word: string): Promise<SpellSuggestResult | null> {
  const bridge = api();
  if (bridge === undefined || bridge === null) {
    return Promise.resolve(null);
  }
  return bridge['spell:suggest']({ word }).then((result) => result).catch(() => null);
}
