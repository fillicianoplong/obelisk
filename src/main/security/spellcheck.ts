// The spell checker uses languages the operating system already has.
// The download address is a local URL so a Hunspell dictionary is never fetched.

export const SPELLCHECK_DICTIONARY_DOWNLOAD_URL = 'file:///obelisk-spellchecker-offline/';

const WORD_MAX = 64;
const SUGGESTION_MAX = 5;

export function spellCheckerLanguages(
  available: readonly string[],
  current: readonly string[],
): string[] {
  const known = new Set(available);
  const kept = current.filter((language) => known.has(language));
  if (kept.length > 0) {
    return kept;
  }
  return available.length > 0 ? [available[0]] : [];
}

export function spellContextFromMenuParams(params: {
  misspelledWord?: unknown;
  dictionarySuggestions?: unknown;
}): { misspelledWord: string; suggestions: string[] } {
  const misspelledWord = typeof params.misspelledWord === 'string'
    ? params.misspelledWord.slice(0, WORD_MAX)
    : '';
  const suggestions = Array.isArray(params.dictionarySuggestions)
    ? params.dictionarySuggestions
      .filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= WORD_MAX)
      .slice(0, SUGGESTION_MAX)
    : [];
  return { misspelledWord, suggestions };
}
