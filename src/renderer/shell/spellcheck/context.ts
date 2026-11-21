import type { EditorState } from 'prosemirror-state';
import { wordAroundCaret } from '../../editor/spell-replace.js';
import { spellcheckEnabled } from '../../editor/spellcheck-mode.js';
import type { SpellContextEvent } from '../../../shared/ipc/types.js';

export interface SpellingTarget {
  word: string;
  suggestions: string[];
}

let latest: SpellContextEvent | null = null;
let latestAt = 0;
let listening = false;
const waiters: Array<(event: SpellContextEvent) => void> = [];

function note(event: SpellContextEvent): void {
  latest = event;
  latestAt = Date.now();
  const pending = waiters.splice(0, waiters.length);
  for (const waiter of pending) {
    waiter(event);
  }
}

export function startSpellContextListener(): void {
  if (listening || typeof window === 'undefined' || window.obelisk?.['spell:context'] === undefined) {
    return;
  }
  listening = true;
  window.obelisk['spell:context'].subscribe((payload) => {
    note(payload);
  });
}

const SUGGESTION_LIMIT = 5;

export function spellingForEditor(state: EditorState): SpellingTarget | null {
  if (!spellcheckEnabled() || typeof window === 'undefined') {
    return null;
  }
  const word = wordAroundCaret(state);
  const lookup = window.obelisk?.['spell:lookup'];
  if (word === null || typeof lookup !== 'function') {
    return null;
  }
  let result: { misspelled?: boolean; suggestions?: unknown };
  try {
    result = lookup(word);
  } catch {
    return null;
  }
  if (result == null || result.misspelled !== true) {
    return null;
  }
  const suggestions = Array.isArray(result.suggestions)
    ? result.suggestions.filter((item): item is string => typeof item === 'string' && item.length > 0).slice(0, SUGGESTION_LIMIT)
    : [];
  return { word, suggestions };
}

export function spellContextForMenu(since: number, waitMs = 400): Promise<SpellingTarget | null> {
  startSpellContextListener();
  const ready = (): SpellingTarget | null => {
    if (latest === null || latestAt < since) {
      return null;
    }
    return { word: latest.misspelledWord, suggestions: latest.suggestions };
  };
  const current = ready();
  if (current !== null || latestAt >= since) {
    return Promise.resolve(current);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      const index = waiters.indexOf(finish);
      if (index >= 0) {
        waiters.splice(index, 1);
      }
      resolve(ready());
    }, waitMs);
    function finish(): void {
      clearTimeout(timer);
      resolve(ready());
    }
    waiters.push(finish);
  });
}

let active: SpellingTarget | null = null;

export function rememberSpellingTarget(info: SpellingTarget | null): void {
  active = info !== null && info.word.length > 0 ? info : null;
}

export function spellingSuggestionAt(index: number): { word: string; suggestion: string } | null {
  if (active === null || !Number.isInteger(index) || index < 0 || index >= active.suggestions.length) {
    return null;
  }
  return { word: active.word, suggestion: active.suggestions[index] };
}

export function spellingWordToAdd(): string | null {
  if (active === null || active.word.length === 0) {
    return null;
  }
  return active.word;
}
