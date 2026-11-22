import nspell from 'nspell';

const SUGGESTION_MAX = 5;

// The bundled list has "OK" and not the lowercase forms people type.
const ALLOWED = new Set(['ok', 'okay']);

export interface SpellEngine {
  misspelled(word: string): boolean;
  suggestions(word: string): string[];
  add(word: string): void;
}

export function createSpellEngine(aff: Buffer, dic: Buffer, words: readonly string[] = []): SpellEngine {
  const spell = nspell(aff, dic);
  for (const word of words) {
    spell.add(word);
  }
  return {
    misspelled(word) {
      if (ALLOWED.has(word.toLowerCase())) {
        return false;
      }
      return spell.correct(word) !== true;
    },
    suggestions(word) {
      return spell.suggest(word).filter((item) => item.length > 0 && item !== word).slice(0, SUGGESTION_MAX);
    },
    add(word) {
      spell.add(word);
    },
  };
}
