import type { SpellContextEvent } from '../../../shared/ipc/types.js';

// webFrame.isWordMisspelled reports every word as correct when Windows uses
// the OS spell checker. Suggestions come from the main-process context-menu event.

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
  for (const waiter of waiters.slice()) {
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

export function spellContextForMenu(since: number, waitMs = 300): Promise<SpellingTarget | null> {
  startSpellContextListener();
  const ready = (): SpellingTarget | null => {
    if (latest === null || latestAt < since || latest.misspelledWord.length === 0) {
      return null;
    }
    return { word: latest.misspelledWord, suggestions: latest.suggestions };
  };
  const drop = (finish: (event: SpellContextEvent) => void): void => {
    const index = waiters.indexOf(finish);
    if (index >= 0) {
      waiters.splice(index, 1);
    }
  };
  if (ready() !== null) {
    return Promise.resolve(ready());
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      drop(finish);
      resolve(null);
    }, waitMs);
    function finish(): void {
      const found = ready();
      if (found === null) {
        return;
      }
      clearTimeout(timer);
      drop(finish);
      resolve(found);
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
